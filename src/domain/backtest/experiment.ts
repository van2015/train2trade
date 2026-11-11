import { BacktestConfig, BacktestResult, runBacktest } from '@/domain/backtest/backtest'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { ExecutionModelConfig } from '@/domain/execution/executionModel'
import { RiskConfig } from '@/domain/portfolio/riskManager'

export class ExperimentError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('ExperimentError', invalidMessage('Experimento inválido', reason, raw))
  }
}

/**
 * Experimento reproducible (§9 + §12C): une la **configuración completa** que
 * condiciona el resultado — estrategia y versión (`name@version`), timeframe,
 * periodo de datos, capital, modelo de ejecución y riesgo — con su
 * `BacktestResult`. Mismo `Experiment.run(config)` → mismos resultados.
 *
 * Sin persistencia en esta fase (decisión de alcance): los experimentos viven
 * en memoria; guardarlos/compararlos queda para Fase 6.
 */
export class Experiment {
  readonly strategyId: string
  readonly timeframe: Timeframe
  readonly period: { from: number; to: number }
  readonly initialCapital: number
  readonly execution: Required<ExecutionModelConfig>
  readonly risk: Required<RiskConfig>
  readonly result: BacktestResult

  private constructor(data: {
    strategyId: string
    timeframe: Timeframe
    period: { from: number; to: number }
    initialCapital: number
    execution: Required<ExecutionModelConfig>
    risk: Required<RiskConfig>
    result: BacktestResult
  }) {
    this.strategyId = data.strategyId
    this.timeframe = data.timeframe
    this.period = data.period
    this.initialCapital = data.initialCapital
    this.execution = data.execution
    this.risk = data.risk
    this.result = data.result
  }

  /** Valida la config, ejecuta el backtest y registra todo lo que lo condiciona. */
  static run(config: BacktestConfig): Experiment {
    const { strategy, candles, timeframe, initialCapital, execution, risk } = config

    if (candles.length === 0) {
      throw new ExperimentError('se necesita al menos una vela', candles.length)
    }
    if (!(timeframe instanceof Timeframe)) {
      throw new ExperimentError('timeframe debe ser un Timeframe', timeframe)
    }
    if (
      typeof initialCapital !== 'number' ||
      !Number.isFinite(initialCapital) ||
      initialCapital <= 0
    ) {
      throw new ExperimentError('initialCapital debe ser un número finito > 0', initialCapital)
    }

    // El backtest valida además el orden ascendente de las velas (§12C).
    const result = runBacktest(config)

    const first = candles[0]
    const last = candles[candles.length - 1]
    if (first === undefined || last === undefined) {
      throw new ExperimentError('se necesita al menos una vela', candles.length)
    }

    return new Experiment({
      strategyId: strategy.toString(),
      timeframe,
      period: { from: first.time, to: last.time },
      initialCapital,
      execution: {
        slippageBps: execution?.slippageBps ?? 0,
        feeBps: execution?.feeBps ?? 0,
      },
      risk: {
        maxPositionFraction: risk?.maxPositionFraction ?? 1,
        minCashReserve: risk?.minCashReserve ?? 0,
        feeBps: risk?.feeBps ?? 0,
        slippageBps: risk?.slippageBps ?? 0,
      },
      result,
    })
  }
}
