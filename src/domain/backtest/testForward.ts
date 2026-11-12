import { BacktestConfig } from '@/domain/backtest/backtest'
import { Experiment } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { splitCandles } from '@/domain/backtest/split'

export interface TestForwardConfig extends BacktestConfig {
  /** Instante del corte (ms): desarrollo `< cutTime`, evaluación `>= cutTime`. */
  cutTime: number
}

export interface TestForwardRun {
  cutTime: number
  development: Experiment
  evaluation: Experiment
  /** `evaluation − development` por métrica; ausente si alguna de las dos es `null`. */
  deltas: Partial<Record<keyof Metrics, number>>
}

/**
 * Test-forward (§7C): dos ejecuciones **independientes** sobre la división de
 * `splitCandles` — la evaluación arranca con `initialCapital` completo, sin
 * heredar nada del desarrollo. `deltas` compara métrica a métrica (eval − dev);
 * si alguna es `null` en alguno de los dos lados, su delta **no existe** (no
 * se inventa `0`).
 *
 * Determinista (§12C): misma config → mismos experimentos. La estrategia se
 * reutiliza en ambos lados (es estadoless, como en `reset` del replay): una
 * regla con estado interno no sería reproducible.
 */
export function runTestForward(config: TestForwardConfig): TestForwardRun {
  const { cutTime, ...backtestConfig } = config
  const split = splitCandles(config.candles, cutTime)

  const development = Experiment.run({ ...backtestConfig, candles: split.development })
  const evaluation = Experiment.run({ ...backtestConfig, candles: split.evaluation })

  return {
    cutTime,
    development,
    evaluation,
    deltas: computeDeltas(development.result.metrics, evaluation.result.metrics),
  }
}

/** `eval − dev` por métrica; claves con `null` en cualquiera de los dos → ausentes. */
function computeDeltas(
  development: Metrics,
  evaluation: Metrics,
): Partial<Record<keyof Metrics, number>> {
  const deltas: Partial<Record<keyof Metrics, number>> = {}
  for (const key of Object.keys(development) as (keyof Metrics)[]) {
    const before = development[key]
    const after = evaluation[key]
    if (before === null || after === null) continue
    deltas[key] = after - before
  }
  return deltas
}
