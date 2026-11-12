import {
  BacktestConfig,
  BacktestResult,
  findConfigProblem,
  runBacktest,
} from '@/domain/backtest/backtest'
import { EquityPoint, Metrics } from '@/domain/backtest/metrics'
import { Trade } from '@/domain/backtest/trade'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { ExecutionModelConfig } from '@/domain/execution/executionModel'
import { Instrument } from '@/domain/instruments/instrument'
import { RiskConfig } from '@/domain/portfolio/riskManager'
import { canonicalHash, strategyFingerprint } from '@/domain/strategies/fingerprint'

export class ExperimentError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('ExperimentError', invalidMessage('Experimento inválido', reason, raw))
  }
}

/** Snapshot serializable de un experimento (§9/§12C): puro, sin `orders`/`events`. */
export interface ExperimentSnapshot {
  /** Hash determinista del contenido (sin id): misma config + resultado → mismo id. */
  id: string
  strategyId: string // "name@version"
  fingerprint: string
  /** "BTC/USDT" o `null` si no se registró. */
  instrument: string | null
  /** Código del timeframe (p. ej. "1h"); se reconstruye con `Timeframe.from`. */
  timeframe: string
  period: { from: number; to: number }
  initialCapital: number
  execution: Required<ExecutionModelConfig>
  risk: Required<RiskConfig>
  metrics: Metrics
  finalEquity: number
  equityCurve: readonly EquityPoint[]
  trades: readonly Trade[] // roundtrip vía `toJSON` / `Trade.from`
}

/**
 * Experimento reproducible (§9 + §12C): une la **configuración completa** que
 * condiciona el resultado — estrategia y versión (`name@version`), huella,
 * instrumento, timeframe, periodo de datos, capital, modelo de ejecución y
 * riesgo — con su `BacktestResult`. Mismo `Experiment.run(config)` → mismos
 * resultados. La persistencia (Fase 6) sale de aquí: `toSnapshot()` +
 * `ExperimentRepository` (localStorage), con `id` determinístico por
 * contenido.
 */
export class Experiment {
  readonly strategyId: string
  /** Huella reproducible de la definición (§12C): detecta cambios de reglas/parámetros. */
  readonly fingerprint: string
  /** Instrumento registrado (§12C); `null` si no se indicó. No interviene en la ejecución. */
  readonly instrument: Instrument | null
  readonly timeframe: Timeframe
  readonly period: { from: number; to: number }
  readonly initialCapital: number
  readonly execution: Required<ExecutionModelConfig>
  readonly risk: Required<RiskConfig>
  readonly result: BacktestResult

  private constructor(data: {
    strategyId: string
    fingerprint: string
    instrument: Instrument | null
    timeframe: Timeframe
    period: { from: number; to: number }
    initialCapital: number
    execution: Required<ExecutionModelConfig>
    risk: Required<RiskConfig>
    result: BacktestResult
  }) {
    this.strategyId = data.strategyId
    this.fingerprint = data.fingerprint
    this.instrument = data.instrument
    this.timeframe = data.timeframe
    this.period = data.period
    this.initialCapital = data.initialCapital
    this.execution = data.execution
    this.risk = data.risk
    this.result = data.result
  }

  /**
   * Valida la config (reglas compartidas con `runBacktest`, traducidas aquí a
   * `ExperimentError`), ejecuta el backtest y registra todo lo que lo
   * condiciona. `execution`/`risk` se toman del resultado: son los valores
   * efectivos con los que corrió, no una segunda copia de los defaults.
   */
  static run(config: BacktestConfig): Experiment {
    const { strategy, candles, timeframe, initialCapital } = config

    const problem = findConfigProblem(config)
    if (problem !== null) {
      throw new ExperimentError(problem.reason, problem.raw)
    }

    // El backtest valida además el orden ascendente de las velas (§12C).
    const result = runBacktest(config)

    const first = candles[0]
    const last = candles[candles.length - 1]
    // Inalcanzable (findConfigProblem ya descartó las velas vacías): lo pide noUncheckedIndexedAccess.
    if (first === undefined || last === undefined) {
      throw new ExperimentError('se necesita al menos una vela', candles.length)
    }

    return new Experiment({
      strategyId: strategy.toString(),
      fingerprint: strategyFingerprint(strategy),
      instrument: config.instrument ?? null,
      timeframe,
      period: { from: first.time, to: last.time },
      initialCapital,
      execution: result.execution,
      risk: result.risk,
      result,
    })
  }

  /**
   * Snapshot serializable (§9/§12C): metadata + resultado, **sin** `orders`
   * ni `events` (pesados y no hacen falta para comparar). El `id` es el hash
   * del contenido **sin** `id` → misma config + resultado → mismo id, y el
   * snapshot se puede re-guardar sin duplicarse.
   */
  toSnapshot(): ExperimentSnapshot {
    const data = {
      strategyId: this.strategyId,
      fingerprint: this.fingerprint,
      instrument: this.instrument?.toString() ?? null,
      timeframe: this.timeframe.code,
      period: { from: this.period.from, to: this.period.to },
      initialCapital: this.initialCapital,
      execution: { ...this.execution },
      risk: { ...this.risk },
      metrics: { ...this.result.metrics },
      finalEquity: this.result.finalEquity,
      equityCurve: this.result.equityCurve,
      trades: this.result.trades,
    }
    return { id: canonicalHash(data), ...data }
  }
}
