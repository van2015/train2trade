import { describe, expect, it } from 'vitest'
import { Experiment, ExperimentError } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { Instrument } from '@/domain/instruments/instrument'
import { CrossesAbove, CrossesBelow, Rule } from '@/domain/strategies/rules'
import { strategyFingerprint } from '@/domain/strategies/fingerprint'
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

function crossStrategy(version = 1): Strategy {
  return new Strategy({
    name: 'cross-e2e',
    version,
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/** Entrada única sin salida: deja la posición abierta al final (para probar el cierre). */
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

function config(overrides: Partial<Parameters<typeof Experiment.run>[0]> = {}) {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}

describe('Experiment — registro (§12C)', () => {
  it('registra todo lo que condiciona el resultado', () => {
    const experiment = Experiment.run(
      config({
        execution: { slippageBps: 10, feeBps: 25 },
        risk: { maxPositionFraction: 0.5, minCashReserve: 0.1 },
      }),
    )

    expect(experiment.strategyId).toBe('cross-e2e@1')
    expect(experiment.timeframe).toBe(Timeframe.HOUR)
    expect(experiment.period.from).toBe(CANDLES[0]?.time)
    expect(experiment.period.to).toBe(CANDLES[CANDLES.length - 1]?.time)
    expect(experiment.initialCapital).toBe(1_000)
    expect(experiment.execution).toEqual({ slippageBps: 10, feeBps: 25 })
    expect(experiment.risk).toEqual({
      maxPositionFraction: 0.5,
      minCashReserve: 0.1,
      feeBps: 25,
      slippageBps: 10,
    })
    expect(experiment.result.trades).toHaveLength(1)
    expect(experiment.result.metrics.netProfit).toBeLessThan(0)
  })

  it('los defaults de execution y risk quedan registrados explícitos', () => {
    const experiment = Experiment.run(config())
    expect(experiment.execution).toEqual({ slippageBps: 0, feeBps: 0 })
    expect(experiment.risk).toEqual({
      maxPositionFraction: 1,
      minCashReserve: 0,
      feeBps: 0,
      slippageBps: 0,
    })
  })

  it('execution/risk registrados salen del resultado (sin copia de defaults)', () => {
    const experiment = Experiment.run(
      config({ execution: { feeBps: 25 }, risk: { maxPositionFraction: 0.5 } }),
    )
    // Si los defaults cambiaran en RiskManager/NextOpenExecutionModel, el
    // registro tendría que seguir reflejando lo que el backtest usó de verdad.
    expect(experiment.execution).toEqual(experiment.result.execution)
    expect(experiment.risk).toEqual(experiment.result.risk)
    expect(experiment.execution).toEqual({ slippageBps: 0, feeBps: 25 })
    expect(experiment.risk.maxPositionFraction).toBe(0.5)
  })

  it('strategyId es name@version', () => {
    expect(Experiment.run(config({ strategy: crossStrategy(3) })).strategyId).toBe('cross-e2e@3')
  })

  it('registra la huella reproducible de la estrategia (§12C)', () => {
    const experiment = Experiment.run(config())

    expect(experiment.fingerprint).toBe(strategyFingerprint(crossStrategy()))
    expect(Experiment.run(config()).fingerprint).toBe(experiment.fingerprint) // estable
    expect(Experiment.run(config({ strategy: crossStrategy(2) })).fingerprint).not.toBe(
      experiment.fingerprint,
    ) // versión distinta → huella distinta
  })

  it('registra el instrumento cuando se indica (null por defecto)', () => {
    expect(Experiment.run(config()).instrument).toBeNull()

    const instrument = Instrument.of('BTC', 'USDT')
    expect(Experiment.run(config({ instrument })).instrument).toBe(instrument)
  })

  it('closePositionAtEnd llega al resultado del experimento', () => {
    const experiment = Experiment.run(
      config({ strategy: enterOnceStrategy(), closePositionAtEnd: true }),
    )

    expect(experiment.result.trades).toHaveLength(1)
    expect(experiment.result.orders.some((order) => order.id === 'close')).toBe(true)
  })
})

describe('Experiment — reproducibilidad (§12C)', () => {
  it('dos ejecuciones con la misma config producen resultados idénticos', () => {
    const first = Experiment.run(config({ execution: { feeBps: 10 } }))
    const second = Experiment.run(config({ execution: { feeBps: 10 } }))

    expect(second.strategyId).toBe(first.strategyId)
    expect(second.period).toEqual(first.period)
    expect(second.execution).toEqual(first.execution)
    expect(second.risk).toEqual(first.risk)
    expect(second.result).toEqual(first.result)
  })
})

describe('Experiment — validación', () => {
  it('rechaza velas vacías, timeframe inválido y capital inválido', () => {
    expect(() => Experiment.run(config({ candles: [] }))).toThrow(ExperimentError)
    expect(() => Experiment.run(config({ timeframe: '1h' as unknown as Timeframe }))).toThrow(
      ExperimentError,
    )
    expect(() => Experiment.run(config({ initialCapital: 0 }))).toThrow(ExperimentError)
    expect(() => Experiment.run(config({ initialCapital: Number.NaN }))).toThrow(ExperimentError)
  })

  it('el error fija this.name', () => {
    try {
      Experiment.run(config({ candles: [] }))
      expect.unreachable('debería lanzar ExperimentError')
    } catch (error) {
      expect((error as ExperimentError).name).toBe('ExperimentError')
    }
  })
})
