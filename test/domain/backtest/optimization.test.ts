import { describe, expect, it } from 'vitest'
import { BacktestConfig, runBacktest } from '@/domain/backtest/backtest'
import { rankBy } from '@/domain/backtest/compare'
import {
  MAX_OPTIMIZATION_RUNS,
  OptimizationConfig,
  OptimizationError,
  runOptimization,
} from '@/domain/backtest/optimization'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000
const stepMs = 60_000
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

function buildStrategy(params: Readonly<Record<string, number>>): Strategy {
  const fast = params.fast ?? 10
  const slow = params.slow ?? 30
  return new Strategy({
    name: 'opt-sma',
    indicators: { fast: new Sma(fast), slow: new Sma(slow) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

const base: Omit<BacktestConfig, 'strategy'> = {
  candles: CANDLES,
  timeframe: Timeframe.HOUR,
  initialCapital: 1_000,
}

function config(overrides: Partial<OptimizationConfig> = {}): OptimizationConfig {
  return {
    buildStrategy,
    grid: { fast: [2], slow: [3] },
    metric: 'netProfit',
    base,
    ...overrides,
  }
}

describe('runOptimization — producto cartesiano (§13)', () => {
  it('genera todas las combinaciones en orden lexicográfico (la última clave varía más rápido)', () => {
    const result = runOptimization(config({ grid: { fast: [2, 3], slow: [4, 5, 6] } }))

    expect(result.runs.map((run) => run.params)).toEqual([
      { fast: 2, slow: 4 },
      { fast: 2, slow: 5 },
      { fast: 2, slow: 6 },
      { fast: 3, slow: 4 },
      { fast: 3, slow: 5 },
      { fast: 3, slow: 6 },
    ])
    expect(result.runs).toHaveLength(6)

    // una sola dimensión
    const single = runOptimization(config({ grid: { fast: [5, 7] } }))
    expect(single.runs.map((run) => run.params)).toEqual([{ fast: 5 }, { fast: 7 }])
    expect(result.grid.fast).toEqual([2, 3])
    expect(result.metric).toBe('netProfit')
  })

  it('cada run registra params, metrics, finalEquity y tradeCount (sin orders/events)', () => {
    const result = runOptimization(config())
    const run = result.runs[0]
    expect(run).toBeDefined()

    const expected = runBacktest({ ...base, strategy: buildStrategy(run!.params) })
    expect(run!.metrics).toEqual(expected.metrics)
    expect(run!.finalEquity).toBe(expected.finalEquity)
    expect(run!.tradeCount).toBe(expected.trades.length)
    expect(run!).not.toHaveProperty('orders')
    expect(run!).not.toHaveProperty('events')
  })

  it('determinismo (§12C): mismo grid → mismos runs, best y worst', () => {
    const first = runOptimization(config({ grid: { fast: [2, 3], slow: [3, 4] } }))
    const second = runOptimization(config({ grid: { fast: [2, 3], slow: [3, 4] } }))

    expect(second.runs).toEqual(first.runs)
    expect(second.best).toEqual(first.best)
    expect(second.worst).toEqual(first.worst)
  })

  it('rejilla vacía → una ejecución con params vacíos (producto vacío)', () => {
    const result = runOptimization(config({ grid: {} }))
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.params).toEqual({})
    expect(result.best).toEqual(result.runs[0])
    expect(result.worst).toEqual(result.runs[0])
  })
})

describe('runOptimization — validación y errores', () => {
  it('values vacías o no arrays → OptimizationError', () => {
    expect(() => runOptimization(config({ grid: { fast: [], slow: [4] } }))).toThrow(
      OptimizationError,
    )
    expect(() =>
      runOptimization(config({ grid: { fast: [2], slow: undefined as unknown as number[] } })),
    ).toThrow(OptimizationError)
  })

  it('la rejilla que supera MAX_OPTIMIZATION_RUNS se rechaza antes de ejecutar', () => {
    const many = Array.from({ length: 32 }, (_, index) => index + 1) // 32 × 32 = 1024

    expect(() => runOptimization(config({ grid: { fast: many, slow: many } }))).toThrow(
      OptimizationError,
    )
    try {
      runOptimization(config({ grid: { fast: many, slow: many } }))
      expect.unreachable('debería lanzar OptimizationError')
    } catch (error) {
      expect((error as OptimizationError).message).toContain(String(MAX_OPTIMIZATION_RUNS))
      expect((error as OptimizationError).name).toBe('OptimizationError')
    }
  })

  it('error de buildStrategy → OptimizationError con los params del combo (aborta)', () => {
    const failing = (params: Readonly<Record<string, number>>): Strategy => {
      if (params.fast === 3) throw new Error('boom')
      return buildStrategy(params)
    }

    try {
      runOptimization(config({ buildStrategy: failing, grid: { fast: [2, 3] } }))
      expect.unreachable('debería lanzar OptimizationError')
    } catch (error) {
      expect(error).toBeInstanceOf(OptimizationError)
      expect((error as OptimizationError).message).toContain('"fast":3')
      expect((error as OptimizationError).message).toContain('boom')
    }
  })

  it('error de la ejecución (config inválida) → OptimizationError', () => {
    expect(() => runOptimization(config({ base: { ...base, initialCapital: 0 } }))).toThrow(
      OptimizationError,
    )
  })
})

describe('runOptimization — best/worst por métrica (§13)', () => {
  it('extremos con nulls al final y coherentes con rankBy', () => {
    // (10,30)/(10,3)/(2,30) no generan trades → winRate null; (2,3) sí (pérdida → 0).
    const result = runOptimization(
      config({ grid: { fast: [10, 2], slow: [30, 3] }, metric: 'winRate' }),
    )

    expect(result.best.params).toEqual({ fast: 2, slow: 3 })
    expect(result.best.metrics.winRate).toBe(0)
    expect(result.worst.params).toEqual({ fast: 2, slow: 30 }) // último null en orden estable
    expect(result.worst.metrics.winRate).toBeNull()

    // Coherencia literal con el ranking de comparación (misma semántica).
    const rows = result.runs.map((run, index) => ({
      id: String(index),
      strategyId: 'opt-sma@1',
      instrument: null,
      timeframe: '1h',
      period: { from: t0, to: t0 },
      initialCapital: 1_000,
      metrics: run.metrics,
      finalEquity: run.finalEquity,
    }))
    const ranked = rankBy(rows, 'winRate')
    expect(ranked[0]?.id).toBe(String(result.runs.indexOf(result.best)))
    expect(ranked[ranked.length - 1]?.id).toBe(String(result.runs.indexOf(result.worst)))
  })

  it('sin nulls: best el máximo y worst el mínimo de la métrica', () => {
    const result = runOptimization(
      config({ grid: { fast: [2, 10], slow: [3] }, metric: 'netProfit' }),
    )

    const values = result.runs.map((run) => run.metrics.netProfit)
    expect(result.best.metrics.netProfit).toBe(Math.max(...values))
    expect(result.worst.metrics.netProfit).toBe(Math.min(...values))
  })
})
