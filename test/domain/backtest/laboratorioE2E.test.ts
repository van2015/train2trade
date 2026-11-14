import { describe, expect, it } from 'vitest'
import { compareExperiments, rankBy } from '@/domain/backtest/compare'
import { Experiment } from '@/domain/backtest/experiment'
import { runOptimization } from '@/domain/backtest/optimization'
import { analyzeRobustness } from '@/domain/backtest/robustness'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { Instrument } from '@/domain/instruments/instrument'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { ExperimentRepository } from '@/storage/experimentRepository'

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

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'sma-cross',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

function buildStrategy(params: Readonly<Record<string, number>>): Strategy {
  return new Strategy({
    name: 'sma-cross',
    indicators: { fast: new Sma(params.fast ?? 10), slow: new Sma(params.slow ?? 30) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

type LabConfig = Partial<Parameters<typeof Experiment.run>[0]>

function base(overrides: LabConfig = {}) {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}

/** Pipeline completo del laboratorio; se ejecuta dos veces para el determinismo (§12C). */
function laboratory() {
  const repository = new ExperimentRepository(new MemoryStorage())

  const experiment = Experiment.run(base({ instrument: Instrument.of('BTC', 'USDT') }))
  const snapshot = experiment.toSnapshot()
  repository.save(snapshot)
  repository.save(Experiment.run(base({ instrument: Instrument.of('BTC', 'USDT') })).toSnapshot())

  const optimization = runOptimization({
    buildStrategy,
    grid: { fast: [2, 10], slow: [3, 30] },
    metric: 'netProfit',
    base: { candles: CANDLES, timeframe: Timeframe.HOUR, initialCapital: 1_000 },
  })
  const robustness = analyzeRobustness(optimization)
  const comparison = compareExperiments([
    snapshot,
    Experiment.run(
      base({ instrument: Instrument.of('ETH', 'USDT'), timeframe: Timeframe.FOUR_HOURS }),
    ).toSnapshot(),
  ])

  return {
    experiment,
    snapshot,
    stored: repository.list(),
    optimization,
    robustness,
    comparison,
  }
}

describe('Laboratorio Fase 6 — E2E (§9/§12C/§13)', () => {
  it('1. backtest → experimento → snapshot → repositorio (id estable y dedupe)', () => {
    const repository = new ExperimentRepository(new MemoryStorage())
    const first = Experiment.run(base({ instrument: Instrument.of('BTC', 'USDT') }))
    const snapshot = first.toSnapshot()

    expect(first.strategyId).toBe('sma-cross@1')
    expect(snapshot.instrument).toBe('BTC/USDT')
    expect(snapshot.timeframe).toBe('1h')
    expect(snapshot).not.toHaveProperty('result') // el snapshot no arrastra el BacktestResult

    repository.save(snapshot)
    // re-ejecutar la misma config → mismo id → una sola entrada (§12C)
    repository.save(Experiment.run(base({ instrument: Instrument.of('BTC', 'USDT') })).toSnapshot())

    expect(repository.list()).toHaveLength(1)
    expect(repository.find(snapshot.id)).toEqual(snapshot)
  })

  it('2. optimización 2×2 y robustez verificadas a mano sobre la misma serie', () => {
    const optimization = runOptimization({
      buildStrategy,
      grid: { fast: [2, 10], slow: [3, 30] },
      metric: 'netProfit',
      base: { candles: CANDLES, timeframe: Timeframe.HOUR, initialCapital: 1_000 },
    })

    // Orden lexicográfico (la última clave varía más rápido).
    expect(optimization.runs.map((run) => run.params)).toEqual([
      { fast: 2, slow: 3 },
      { fast: 2, slow: 30 },
      { fast: 10, slow: 3 },
      { fast: 10, slow: 30 },
    ])

    // A mano: solo (2,3) cruza → pérdida −230.77; el resto no señala → 0.
    const loss = -230.76923076923073
    expect(optimization.runs[0]?.metrics.netProfit).toBeCloseTo(loss, 8)
    expect(optimization.runs[1]?.metrics.netProfit).toBe(0)
    expect(optimization.runs[2]?.metrics.netProfit).toBe(0)
    expect(optimization.runs[3]?.metrics.netProfit).toBe(0)
    expect(optimization.best.params).toEqual({ fast: 2, slow: 30 }) // primer 0 en orden estable
    expect(optimization.worst.metrics.netProfit).toBeCloseTo(loss, 8)

    const robustness = analyzeRobustness(optimization)
    expect(robustness.count).toBe(4)
    expect(robustness.best).toBe(0)
    expect(robustness.worst).toBeCloseTo(loss, 8)
    expect(robustness.mean).toBeCloseTo(loss / 4, 8)

    // Plateau del mejor (2,30): vecinos (10,30)=0 y (2,3)=pérdida.
    expect(robustness.plateau.neighbors).toBe(2)
    expect(robustness.plateau.avg).toBeCloseTo(loss / 2, 8)
    expect(robustness.plateau.worst).toBeCloseTo(loss, 8)

    // Sensibilidad: ambas dimensiones separan media(2)=media(3)=loss/2 de media(10)=media(30)=0.
    expect(robustness.sensitivity.map((entry) => entry.param)).toEqual(['fast', 'slow'])
    expect(robustness.sensitivity[0]?.spread).toBeCloseTo(-loss / 2, 8)
    expect(robustness.sensitivity[1]?.spread).toBeCloseTo(-loss / 2, 8)
    expect(robustness.aboveThreshold).toEqual({ threshold: 0, count: 0, fraction: 0 })
  })

  it('3. comparación de experimentos con differences (§9/§12C)', () => {
    const btc = Experiment.run(base({ instrument: Instrument.of('BTC', 'USDT') })).toSnapshot()
    const eth = Experiment.run(
      base({ instrument: Instrument.of('ETH', 'USDT'), timeframe: Timeframe.FOUR_HOURS }),
    ).toSnapshot()

    const table = compareExperiments([btc, eth])
    expect(table.differences).toEqual(['instrument', 'timeframe'])
    expect(table.rows).toHaveLength(2)

    // misma config → sin diferencias; estrategia idéntica → no es campo comparable
    const sameConfig = Experiment.run(
      base({ instrument: Instrument.of('BTC', 'USDT') }),
    ).toSnapshot()
    expect(compareExperiments([btc, sameConfig]).differences).toEqual([])

    // ROI idéntico en ambos (misma serie) → ranking estable conserva el orden de entrada
    expect(rankBy(table.rows, 'roi').map((row) => row.instrument)).toEqual(['BTC/USDT', 'ETH/USDT'])
  })

  it('4. determinismo extremo a extremo: el pipeline completo se repite idéntico (§12C)', () => {
    const first = laboratory()
    const second = laboratory()

    expect(second.experiment).toEqual(first.experiment)
    expect(second.snapshot).toEqual(first.snapshot)
    expect(second.stored).toEqual(first.stored)
    expect(second.optimization).toEqual(first.optimization)
    expect(second.robustness).toEqual(first.robustness)
    expect(second.comparison).toEqual(first.comparison)
  })
})
