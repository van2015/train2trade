import { describe, expect, it } from 'vitest'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { MarketContextError } from '@/domain/strategies/marketContext'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow, Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import {
  TradingSession,
  TradingSessionConfig,
  TradingSessionError,
} from '@/domain/trading/tradingSession'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie del E2E de Fase 3: cruce al alza en i4 (entrada) y a la baja en i7 (salida). */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

function candlesFrom(prices: readonly number[]): Candle[] {
  return prices.map((price, index) =>
    Candle.from({
      time: t0 + index * stepMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
    }),
  )
}

const CANDLES = candlesFrom(PRICES)

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'cross-e2e',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/** Estrategia que dispara una sola vez (para el test de anti look-ahead). */
function enterOnceStrategy(): Strategy {
  let fired = false
  const rule: Rule = {
    name: 'enter once',
    evaluate: () => {
      if (fired) return false
      fired = true
      return true
    },
  }
  return new Strategy({
    name: 'enter-once',
    signals: [new Signal(StrategyAction.RequestEntry, rule)],
  })
}

function baseConfig(overrides: Partial<TradingSessionConfig> = {}): TradingSessionConfig {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}

/** Sesión con observabilidad de Fase 4: el consumidor tipa el broker decorado. */
function openSession(config: TradingSessionConfig): TradingSession<RecordingBroker> {
  return new TradingSession(config, (inner, account) => new RecordingBroker(inner, account))
}

describe('TradingSession — construcción y validación', () => {
  it('config inválida → TradingSessionError (velas vacías, timeframe y capital)', () => {
    expect(() => new TradingSession(baseConfig({ candles: [] }))).toThrow(TradingSessionError)
    expect(
      () => new TradingSession(baseConfig({ timeframe: '1h' as unknown as Timeframe })),
    ).toThrow(TradingSessionError)
    expect(() => new TradingSession(baseConfig({ initialCapital: 0 }))).toThrow(TradingSessionError)
    expect(() => new TradingSession(baseConfig({ initialCapital: Number.NaN }))).toThrow(
      TradingSessionError,
    )
  })

  it('sin decorador, el broker es un broker histórico plano sin registro de trades', () => {
    const session = new TradingSession(baseConfig())
    expect(session.broker.pendingOrders()).toEqual([])
    expect(session.broker.positions()).toEqual([])
  })
})

describe('TradingSession — avance vela a vela', () => {
  it('cursor y finished: 0/false al inicio, N/true tras procesar todas', () => {
    const session = openSession(baseConfig())
    expect(session.cursor).toBe(0)
    expect(session.finished).toBe(false)

    while (!session.finished) {
      session.advance()
    }

    expect(session.cursor).toBe(CANDLES.length)
    expect(session.finished).toBe(true)
  })

  it('advance tras terminar → TradingSessionError', () => {
    const session = openSession(baseConfig())
    while (!session.finished) {
      session.advance()
    }
    expect(() => session.advance()).toThrow(TradingSessionError)
  })

  it('cada paso devuelve índice, vela, eventos propios y equity de ese cierre', () => {
    const session = openSession(baseConfig())
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
    const session = openSession(baseConfig())
    expect(session.clock.now).toBeNull()

    const first = session.advance()
    expect(session.clock.now).toBe(first.candle.time)

    const second = session.advance()
    expect(session.clock.now).toBe(second.candle.time)
  })

  it('velas no ascendentes → MarketContextError en la segunda vela, sin avanzar el cursor', () => {
    const session = openSession(baseConfig({ candles: [...CANDLES].reverse() }))
    // Una sola vela no puede violar el orden: la violación aparece al cruzar la 2.
    session.advance()
    expect(() => session.advance()).toThrow(MarketContextError)
    expect(session.cursor).toBe(1)
  })
})

describe('TradingSession — sin look-ahead', () => {
  it('la orden decidida en la vela 0 rellena en la 1: equity intacto en la primera', () => {
    const session = openSession(baseConfig({ strategy: enterOnceStrategy() }))

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

    const first = runAll(openSession(baseConfig({ execution: { slippageBps: 10, feeBps: 10 } })))
    const second = runAll(openSession(baseConfig({ execution: { slippageBps: 10, feeBps: 10 } })))

    expect(second.events).toEqual(first.events)
    expect(second.orders).toEqual(first.orders)
    expect(second.trades).toEqual(first.trades)
    expect(second.trades).toHaveLength(1)
  })

  it('con decorador: Σ trades.pnl = realizedPnl tras cerrar la posición', () => {
    const session = openSession(baseConfig())
    while (!session.finished) session.advance()

    const total = session.broker.trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(session.broker.trades).toHaveLength(1)
    expect(total).toBeCloseTo(session.portfolio.realizedPnl, 10)
  })

  it('registra execution/risk con los defaults resueltos y fuente única de costes', () => {
    const plain = openSession(baseConfig())
    expect(plain.executionConfig).toEqual({ slippageBps: 0, feeBps: 0 })
    expect(plain.riskConfig).toEqual({
      maxPositionFraction: 1,
      minCashReserve: 0,
      feeBps: 0,
      slippageBps: 0,
    })

    const withCosts = openSession(baseConfig({ execution: { slippageBps: 10, feeBps: 30 } }))
    expect(withCosts.executionConfig).toEqual({ slippageBps: 10, feeBps: 30 })
    expect(withCosts.riskConfig.feeBps).toBe(withCosts.executionConfig.feeBps)
    expect(withCosts.riskConfig.slippageBps).toBe(withCosts.executionConfig.slippageBps)
  })
})
