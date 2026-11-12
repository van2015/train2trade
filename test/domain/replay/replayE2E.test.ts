import { describe, expect, it } from 'vitest'
import { runBacktest } from '@/domain/backtest/backtest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { MarketReplayEngine, ReplayLogEntry } from '@/domain/replay/replayEngine'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { TradingSessionConfig } from '@/domain/trading/tradingSession'
import { ExecutionEvent } from '@/domain/trading/strategyRunner'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E de Fase 3/4: cruce al alza en i4, salida posterior. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

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

function baseConfig(overrides: Partial<TradingSessionConfig> = {}): TradingSessionConfig {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}

describe('Replay E2E — simulación interactiva (Fase 5)', () => {
  it('una sesión paso a paso reproduce exactamente el backtest (motor compartido, §7)', () => {
    const backtest = runBacktest(baseConfig())

    const engine = new MarketReplayEngine(baseConfig())
    const equityCurve: { time: number; equity: number }[] = []
    const events: ExecutionEvent[] = []
    while (engine.status !== 'finished') {
      const step = engine.step()
      const candle = engine.session.candles[step.index]
      if (candle !== undefined) {
        equityCurve.push({ time: step.time, equity: engine.session.portfolio.equity(candle.close) })
      }
      events.push(...step.events)
    }

    expect(equityCurve).toEqual(backtest.equityCurve)
    expect(events).toEqual(backtest.events)
    expect(engine.session.broker.orders).toEqual(backtest.orders)
    expect(engine.session.broker.trades).toEqual(backtest.trades)
    expect(equityCurve[equityCurve.length - 1]?.equity).toBe(backtest.finalEquity)
    expect(backtest.trades).toHaveLength(1)
  })

  it('manualBuy a mitad del recorrido: rellena en la siguiente vela y respeta los invariantes', () => {
    const engine = new MarketReplayEngine(baseConfig())

    engine.step()
    engine.step()
    engine.step() // cursor en i3, antes del cruce
    const order = engine.manualBuy(0.5)
    expect(order?.qty).toBeCloseTo(5, 10) // 50% de 1 000 @ 100 (cierre de i2)
    expect(engine.session.broker.pendingOrders()).toHaveLength(1)

    const next = engine.step() // la orden rellena en la apertura de i3 (anti look-ahead)
    expect(next.events).toContain('OrderFilled')
    expect(engine.session.portfolio.position?.qty).toBeCloseTo(5, 10)

    while (engine.status !== 'finished') engine.step()

    // Invariantes de Fase 4 intactos con operaciones manuales de por medio.
    const trades = engine.session.broker.trades
    expect(trades.length).toBeGreaterThanOrEqual(1)
    const total = trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(total).toBeCloseTo(engine.session.portfolio.realizedPnl, 10)

    // El log refleja el envío y el relleno manual, además de las decisiones.
    expect(
      engine.log.some((entry) => entry.kind === 'manual' && entry.text.includes('enviada')),
    ).toBe(true)
    expect(
      engine.log.some((entry) => entry.kind === 'manual' && entry.text.includes('rellenada')),
    ).toBe(true)
    expect(engine.log.some((entry) => entry.kind === 'strategy')).toBe(true)
  })

  it('reset repite exactamente el mismo recorrido, manuales incluidos (§12C)', () => {
    const engine = new MarketReplayEngine(baseConfig())

    const play = (): {
      log: readonly ReplayLogEntry[]
      events: readonly ExecutionEvent[]
      trades: readonly unknown[]
    } => {
      const log: ReplayLogEntry[] = []
      const events: ExecutionEvent[] = []
      engine.step()
      engine.step()
      engine.manualBuy(0.25)
      while (engine.status !== 'finished') {
        const step = engine.step()
        log.push(...step.log)
        events.push(...step.events)
      }
      return { log, events, trades: engine.session.broker.trades }
    }

    const first = play()
    expect(first.log.length).toBeGreaterThan(0)

    engine.reset()
    expect(engine.status).toBe('ready')
    expect(engine.cursor).toBe(0)
    expect(engine.log).toEqual([])

    const second = play()
    expect(second).toEqual(first)
  })

  it('manualSell cierra la posición y registra el Trade (§9)', () => {
    const engine = new MarketReplayEngine(baseConfig())

    engine.manualBuy(1)
    engine.step() // posición: 10 @ 100
    expect(engine.session.broker.trades).toEqual([])

    const sell = engine.manualSell(1)
    expect(sell?.qty).toBeCloseTo(10, 10)
    engine.step() // cierra en la apertura de i1

    const trades = engine.session.broker.trades
    expect(trades).toHaveLength(1)
    expect(trades[0]?.qty).toBeCloseTo(10, 10)
    expect(trades[0]?.exitTime).toBe(t0 + stepMs)
    expect(trades[0]?.exitPrice).toBe(100)
    expect(engine.session.portfolio.position).toBeNull()
    expect(trades[0]?.pnl).toBeCloseTo(engine.session.portfolio.realizedPnl, 10)
  })
})
