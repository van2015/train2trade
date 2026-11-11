import { describe, expect, it } from 'vitest'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000
const step = 60_000
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * step,
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

function run() {
  return Experiment.run({
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
  })
}

/** Tamaño que produce el risk (floor a 12 decimales de 1000/130). */
const EXPECTED_QTY = Math.floor((1_000 / 130) * 1e12) / 1e12
const EXPECTED_FINAL = EXPECTED_QTY * 100

describe('Fase 4 E2E — experimento completo sobre serie conocida', () => {
  it('verifica las 8 métricas con valores calculados a mano', () => {
    const { result } = run()
    const { metrics, trades, equityCurve, finalEquity, orders, events } = result

    // estructura
    expect(equityCurve).toHaveLength(CANDLES.length)
    expect(trades).toHaveLength(1)
    expect(orders).toHaveLength(2)
    expect(events).toContain('StrategyConfirmed')
    expect(events).toContain('PositionClosed')
    expect(events[0]).toBe('StrategyConfirmed')

    // capital: compra a 130, venta a 100 → pérdida exacta
    expect(finalEquity).toBeCloseTo(EXPECTED_FINAL, 6)
    expect(trades[0]?.qty).toBeCloseTo(EXPECTED_QTY, 6)
    expect(trades[0]?.pnl).toBeCloseTo((100 - 130) * EXPECTED_QTY, 6)

    // métricas
    expect(metrics.netProfit).toBeCloseTo(EXPECTED_FINAL - 1_000, 6)
    expect(metrics.roi).toBeCloseTo((EXPECTED_FINAL - 1_000) / 1_000, 6)
    expect(metrics.maxDrawdown).toBeCloseTo(1 - EXPECTED_FINAL / 1_000, 6)
    expect(typeof metrics.sharpe).toBe('number')
    expect(metrics.sharpe ?? Number.NaN).toBeLessThan(0) // serie con pérdida
    expect(metrics.profitFactor).toBe(0) // sin ganancias
    expect(metrics.winRate).toBe(0)
    expect(metrics.avgTrade).toBeCloseTo(trades[0]?.pnl ?? Number.NaN, 6)
    expect(metrics.expectancy).toBeCloseTo(metrics.avgTrade ?? Number.NaN, 10)
  })

  it('invariantes: Σ pnl = finalEquity − inicial y la curva termina en el equity final', () => {
    const { result } = run()
    const total = result.trades.reduce((sum, trade) => sum + trade.pnl, 0)

    expect(result.finalEquity).toBeCloseTo(1_000 + total, 6)
    expect(result.equityCurve[result.equityCurve.length - 1]?.equity).toBeCloseTo(
      result.finalEquity,
      10,
    )
    // el equity de la primera vela está intacto (sin look-ahead)
    expect(result.equityCurve[0]?.equity).toBe(1_000)
  })

  it('determinismo de extremo a extremo (§12C)', () => {
    const first = run()
    const second = run()

    expect(second.strategyId).toBe(first.strategyId)
    expect(second.period).toEqual(first.period)
    expect(second.execution).toEqual(first.execution)
    expect(second.risk).toEqual(first.risk)
    expect(second.result).toEqual(first.result)
  })
})
