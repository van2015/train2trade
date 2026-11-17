import { describe, expect, it } from 'vitest'
import { RecordingBroker } from '@/domain/execution/recordingBroker'
import { Timeframe } from '@/domain/candles/timeframe'
import { MarketContextError } from '@/domain/strategies/marketContext'
import {
  TradingSession,
  TradingSessionConfig,
  TradingSessionError,
} from '@/domain/trading/tradingSession'
import { candlesFrom } from '../../support/candles'
import { enterOnceStrategy } from '../../support/strategies'
import { baseConfig } from '../../support/sessions'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie del E2E de Fase 3: cruce al alza en i4 (entrada) y a la baja en i7 (salida). */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = candlesFrom(PRICES, { startMs: t0, stepMs })

/** Sesión con observabilidad de Fase 4: el consumidor tipa el broker decorado. */
function openSession(config: TradingSessionConfig): TradingSession<RecordingBroker> {
  return new TradingSession(config, (inner, account) => new RecordingBroker(inner, account))
}

describe('TradingSession — construcción y validación', () => {
  it('config inválida → TradingSessionError (velas vacías, timeframe y capital)', () => {
    expect(() => new TradingSession(baseConfig(CANDLES, { candles: [] }))).toThrow(
      TradingSessionError,
    )
    expect(() => new TradingSession(baseConfig(CANDLES, { candles: [] }))).toThrow(
      'se necesita al menos una vela',
    )
    expect(
      () => new TradingSession(baseConfig(CANDLES, { timeframe: '1h' as unknown as Timeframe })),
    ).toThrow(TradingSessionError)
    expect(
      () => new TradingSession(baseConfig(CANDLES, { timeframe: '1h' as unknown as Timeframe })),
    ).toThrow('timeframe debe ser un Timeframe')
    expect(() => new TradingSession(baseConfig(CANDLES, { initialCapital: 0 }))).toThrow(
      TradingSessionError,
    )
    expect(() => new TradingSession(baseConfig(CANDLES, { initialCapital: 0 }))).toThrow(
      'initialCapital debe ser un número finito > 0',
    )
    expect(() => new TradingSession(baseConfig(CANDLES, { initialCapital: Number.NaN }))).toThrow(
      TradingSessionError,
    )
  })

  it('el error tiene name TradingSessionError y el dominio en el mensaje', () => {
    try {
      new TradingSession(baseConfig(CANDLES, { candles: [] }))
      throw new Error('debía lanzar TradingSessionError')
    } catch (error) {
      expect(error).toBeInstanceOf(TradingSessionError)
      expect((error as TradingSessionError).name).toBe('TradingSessionError')
      expect((error as TradingSessionError).message).toContain('Sesión de trading inválida')
    }
  })

  it('sin decorador, el broker es un broker histórico plano sin registro de trades', () => {
    const session = new TradingSession(baseConfig(CANDLES))
    expect(session.broker.pendingOrders()).toEqual([])
    expect(session.broker.positions()).toEqual([])
  })
})

describe('TradingSession — avance vela a vela', () => {
  it('cursor y finished: 0/false al inicio, N/true tras procesar todas', () => {
    const session = openSession(baseConfig(CANDLES))
    expect(session.cursor).toBe(0)
    expect(session.finished).toBe(false)

    while (!session.finished) {
      session.advance()
    }

    expect(session.cursor).toBe(CANDLES.length)
    expect(session.finished).toBe(true)
  })

  it('advance tras terminar → TradingSessionError', () => {
    const session = openSession(baseConfig(CANDLES))
    while (!session.finished) {
      session.advance()
    }
    expect(() => session.advance()).toThrow(TradingSessionError)
    expect(() => session.advance()).toThrow(
      `la sesión ya procesó todas las velas (${CANDLES.length})`,
    )
  })

  it('cada paso devuelve índice, vela, eventos propios y equity de ese cierre', () => {
    const session = openSession(baseConfig(CANDLES))
    const collected: string[] = []

    for (const [index, candle] of CANDLES.entries()) {
      const step = session.advance()
      expect(step.index).toBe(index)
      expect(step.candle).toEqual(candle)
      expect(step.equity).toBe(session.portfolio.equity(candle.close))
      collected.push(...step.events)
    }

    // Misma secuencia exacta que el backtest de Fase 4 (motor compartido, §7).
    expect(collected).toEqual([
      'StrategyConfirmed',
      'OrderSubmitted',
      'PositionOpened',
      'OrderFilled',
      'ExitRequested',
      'OrderSubmitted',
      'PositionClosed',
      'OrderFilled',
    ])
    expect(session.events).toEqual(collected)
  })

  it('el reloj (§12A) avanza al cierre de cada vela procesada', () => {
    const session = openSession(baseConfig(CANDLES))
    expect(session.clock.now).toBeNull()

    const first = session.advance()
    expect(session.clock.now).toBe(first.candle.time)

    const second = session.advance()
    expect(session.clock.now).toBe(second.candle.time)
  })

  it('velas no ascendentes → MarketContextError en la segunda vela, sin avanzar el cursor', () => {
    const session = openSession(baseConfig(CANDLES, { candles: [...CANDLES].reverse() }))
    // Una sola vela no puede violar el orden: la violación aparece al cruzar la 2.
    session.advance()
    expect(() => session.advance()).toThrow(MarketContextError)
    expect(session.cursor).toBe(1)
  })
})

describe('TradingSession — sin look-ahead', () => {
  it('la orden decidida en la vela 0 rellena en la 1: equity intacto en la primera', () => {
    const session = openSession(baseConfig(CANDLES, { strategy: enterOnceStrategy() }))

    const first = session.advance()
    expect(first.events).toContain('OrderSubmitted')
    expect(first.events).not.toContain('PositionOpened')
    expect(first.equity).toBe(1_000)

    const second = session.advance()
    expect(second.events).toContain('PositionOpened')
    expect(second.events).toContain('OrderFilled')
  })
})

describe('TradingSession — determinismo y config efectiva (§12C)', () => {
  it('dos sesiones idénticas producen los mismos eventos, órdenes y trades', () => {
    const runAll = (session: TradingSession<RecordingBroker>) => {
      while (!session.finished) session.advance()
      return {
        events: session.events,
        orders: session.broker.orders,
        trades: session.broker.trades,
      }
    }

    const first = runAll(
      openSession(baseConfig(CANDLES, { execution: { slippageBps: 10, feeBps: 10 } })),
    )
    const second = runAll(
      openSession(baseConfig(CANDLES, { execution: { slippageBps: 10, feeBps: 10 } })),
    )

    expect(second.events).toEqual(first.events)
    expect(second.orders).toEqual(first.orders)
    expect(second.trades).toEqual(first.trades)
    expect(second.trades).toHaveLength(1)
  })

  it('con decorador: Σ trades.pnl = realizedPnl tras cerrar la posición', () => {
    const session = openSession(baseConfig(CANDLES))
    while (!session.finished) session.advance()

    const total = session.broker.trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(session.broker.trades).toHaveLength(1)
    expect(total).toBeCloseTo(session.portfolio.realizedPnl, 10)
  })

  it('registra execution/risk con los defaults resueltos y fuente única de costes', () => {
    const plain = openSession(baseConfig(CANDLES))
    expect(plain.executionConfig).toEqual({ slippageBps: 0, feeBps: 0 })
    expect(plain.riskConfig).toEqual({
      maxPositionFraction: 1,
      minCashReserve: 0,
      feeBps: 0,
      slippageBps: 0,
    })

    const withCosts = openSession(
      baseConfig(CANDLES, { execution: { slippageBps: 10, feeBps: 30 } }),
    )
    expect(withCosts.executionConfig).toEqual({ slippageBps: 10, feeBps: 30 })
    expect(withCosts.riskConfig.feeBps).toBe(withCosts.executionConfig.feeBps)
    expect(withCosts.riskConfig.slippageBps).toBe(withCosts.executionConfig.slippageBps)
  })
})
