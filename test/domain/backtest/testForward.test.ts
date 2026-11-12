import { describe, expect, it } from 'vitest'
import { Experiment } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { SplitError, splitCandles } from '@/domain/backtest/split'
import { runTestForward, TestForwardConfig } from '@/domain/backtest/testForward'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000
const stepMs = 60_000

const CANDLES = Array.from({ length: 9 }, (_, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: [100, 100, 100, 90, 130, 130, 130, 100, 100][index],
    high: [100, 100, 100, 90, 130, 130, 130, 100, 100][index],
    low: [100, 100, 100, 90, 130, 130, 130, 100, 100][index],
    close: [100, 100, 100, 90, 130, 130, 130, 100, 100][index],
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

function neverStrategy(): Strategy {
  return new Strategy({
    name: 'never',
    signals: [new Signal(StrategyAction.RequestEntry, { name: 'no', evaluate: () => false })],
  })
}

function config(overrides: Partial<TestForwardConfig> = {}): TestForwardConfig {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    cutTime: t0 + 6 * stepMs,
    ...overrides,
  }
}

describe('runTestForward — dos ejecuciones independientes (§7C)', () => {
  it('cada experimento solo ve sus propias velas (periodos disjuntos)', () => {
    const run = runTestForward(config())

    expect(run.cutTime).toBe(t0 + 6 * stepMs)
    expect(run.development.period.from).toBe(CANDLES[0]?.time)
    expect(run.development.period.to).toBe(t0 + 5 * stepMs) // < cutTime
    expect(run.evaluation.period.from).toBe(t0 + 6 * stepMs) // >= cutTime
    expect(run.evaluation.period.to).toBe(CANDLES[CANDLES.length - 1]?.time)
    expect(run.development.period.to).toBeLessThan(run.evaluation.period.from)
  })

  it('coincide con backtests aislados sobre cada mitad y ambos arrancan con capital completo', () => {
    const run = runTestForward(config())
    const split = splitCandles(CANDLES, config().cutTime)

    const isolatedDev = Experiment.run({ ...config(), candles: split.development })
    const isolatedEval = Experiment.run({ ...config(), candles: split.evaluation })

    expect(run.development.result).toEqual(isolatedDev.result)
    expect(run.evaluation.result).toEqual(isolatedEval.result)
    expect(run.development.initialCapital).toBe(1_000) // evaluación sin heredar nada (§7C)
    expect(run.evaluation.initialCapital).toBe(1_000)
    expect(run.development.strategyId).toBe(run.evaluation.strategyId)
  })

  it('deltas = evaluación − desarrollo por métrica; ausente si alguna es null', () => {
    const run = runTestForward(config())
    const development = run.development.result.metrics
    const evaluation = run.evaluation.result.metrics

    const keys = Object.keys(development) as (keyof Metrics)[]
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      if (development[key] === null || evaluation[key] === null) {
        expect(run.deltas[key]).toBeUndefined()
      } else {
        expect(run.deltas[key]).toBeCloseTo(evaluation[key] - development[key], 10)
      }
    }
  })

  it('sin trades, las métricas null no generan delta (no se inventa 0)', () => {
    const run = runTestForward(config({ strategy: neverStrategy() }))

    expect(run.deltas.netProfit).toBe(0) // ambos planos: delta presente y 0
    expect(run.deltas.maxDrawdown).toBe(0)
    expect(run.deltas.winRate).toBeUndefined()
    expect(run.deltas.profitFactor).toBeUndefined()
    expect(run.deltas.expectancy).toBeUndefined()
  })

  it('determinismo (§12C): dos ejecuciones idénticas → mismos experimentos y deltas', () => {
    const first = runTestForward(config())
    const second = runTestForward(config())

    expect(second.development).toEqual(first.development)
    expect(second.evaluation).toEqual(first.evaluation)
    expect(second.deltas).toEqual(first.deltas)
  })

  it('errores: corte sin velas a un lado o no finito → SplitError', () => {
    expect(() => runTestForward(config({ cutTime: t0 }))).toThrow(SplitError)
    expect(() => runTestForward(config({ cutTime: t0 + CANDLES.length * stepMs }))).toThrow(
      SplitError,
    )
    expect(() => runTestForward(config({ cutTime: Number.NaN }))).toThrow(SplitError)
  })
})
