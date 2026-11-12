import { Metrics, sortByMetricDesc } from '@/domain/backtest/metrics'
import { OptimizationResult, OptimizationRun } from '@/domain/backtest/optimization'
import { DomainError, invalidMessage } from '@/domain/errors'
import { canonicalJson } from '@/domain/strategies/fingerprint'

export class RobustnessError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('RobustnessError', invalidMessage('Análisis de robustez inválido', reason, raw))
  }
}

export interface SensitivityEntry {
  param: string
  /** max − min de la media de la métrica al variar esa dimensión (efecto principal). */
  spread: number
}

export interface RobustnessReport {
  metric: keyof Metrics
  /** Ejecuciones con la métrica no null (las null se excluyen de las estadísticas). */
  count: number
  best: number
  worst: number
  mean: number
  /** Desviación **muestral** (n − 1); con un solo valor → 0. */
  stdev: number
  /** Vecindario directo del mejor (±1 paso en exactamente una dimensión de la rejilla). */
  plateau: { neighbors: number; avg: number | null; worst: number | null }
  /** Fracción de ejecuciones con métrica > threshold (umbral literal, por defecto 0). */
  aboveThreshold: { threshold: number; count: number; fraction: number }
  /** Dimensiones ordenadas por spread descendente: cuánto influye cada parámetro. */
  sensitivity: readonly SensitivityEntry[]
}

/**
 * Análisis de robustez sobre una rejilla de optimización (§13): estadísticas
 * de la métrica (excluyendo `null`), vecindario directo del mejor (`plateau`),
 * fracción sobre un umbral y **sensibilidad** por dimensión (efecto principal:
 * media de la métrica fijando cada valor del parámetro → `spread`).
 *
 * Determinista: mismo `OptimizationResult` → mismo informe. Los `null`
 * (ejecuciones sin trades u otra razón) no entran en las medias pero sí se
 * cuentan en `plateau.neighbors`; `worst`/`avg` del plateau son `null` si no
 * hay ningún vecino no null.
 */
export function analyzeRobustness(
  result: OptimizationResult,
  options?: { threshold?: number },
): RobustnessReport {
  const metric = result.metric
  const threshold = options?.threshold ?? 0
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new RobustnessError('threshold debe ser un número finito', threshold)
  }

  const validRuns: OptimizationRun[] = []
  const values: number[] = []
  for (const run of result.runs) {
    const value = run.metrics[metric]
    if (value === null) continue
    validRuns.push(run)
    values.push(value)
  }
  if (values.length === 0) {
    throw new RobustnessError(`la métrica ${metric} es null en todas las ejecuciones`, metric)
  }

  const above = values.filter((value) => value > threshold).length
  return {
    metric,
    count: values.length,
    best: Math.max(...values),
    worst: Math.min(...values),
    mean: meanOf(values),
    stdev: sampleStdev(values),
    plateau: computePlateau(result, validRuns, metric),
    aboveThreshold: { threshold, count: above, fraction: above / result.runs.length },
    sensitivity: computeSensitivity(result, metric),
  }
}

/**
 * Vecindario del mejor: combinaciones que difieren en **exactamente una**
 * dimensión ±1 paso (menos vecinos en bordes/caras de la rejilla). El mejor
 * se toma con la misma ordenación que `rankBy` (`sortByMetricDesc`).
 */
function computePlateau(
  result: OptimizationResult,
  validRuns: readonly OptimizationRun[],
  metric: keyof Metrics,
): { neighbors: number; avg: number | null; worst: number | null } {
  const bestRun = sortByMetricDesc(validRuns, metric)[0]
  // Inalcanzable: validRuns no está vacío (ya se validó count > 0).
  if (bestRun === undefined) {
    throw new RobustnessError('no hay ejecuciones válidas para el plateau', metric)
  }

  const byParams = new Map(result.runs.map((run) => [canonicalJson(run.params), run]))
  const neighborRuns: OptimizationRun[] = []

  for (const [param, values] of Object.entries(result.grid)) {
    const index = values.indexOf(bestRun.params[param] ?? Number.NaN)
    // Defensivo: rejilla y params proceden del mismo runOptimization.
    if (index < 0) continue

    for (const neighborIndex of [index - 1, index + 1]) {
      if (neighborIndex < 0 || neighborIndex >= values.length) continue
      const params = { ...bestRun.params, [param]: values[neighborIndex] }
      const neighbor = byParams.get(canonicalJson(params))
      if (neighbor !== undefined) neighborRuns.push(neighbor)
    }
  }

  const neighborValues: number[] = []
  for (const run of neighborRuns) {
    const value = run.metrics[metric]
    if (value !== null) neighborValues.push(value)
  }

  return {
    neighbors: neighborRuns.length,
    avg: neighborValues.length === 0 ? null : meanOf(neighborValues),
    worst: neighborValues.length === 0 ? null : Math.min(...neighborValues),
  }
}

/** Efecto principal por dimensión: medias por valor, `spread` descendente (empates → orden del grid). */
function computeSensitivity(
  result: OptimizationResult,
  metric: keyof Metrics,
): readonly SensitivityEntry[] {
  const entries: { entry: SensitivityEntry; index: number }[] = []

  Object.entries(result.grid).forEach(([param, values], index) => {
    const means: number[] = []
    for (const value of values) {
      const group: number[] = []
      for (const run of result.runs) {
        if (run.params[param] !== value) continue
        const metricValue = run.metrics[metric]
        if (metricValue !== null) group.push(metricValue)
      }
      if (group.length > 0) means.push(meanOf(group))
    }

    const spread = means.length === 0 ? 0 : Math.max(...means) - Math.min(...means)
    entries.push({ entry: { param, spread }, index })
  })

  return entries
    .sort((a, b) =>
      b.entry.spread === a.entry.spread ? a.index - b.index : b.entry.spread - a.entry.spread,
    )
    .map(({ entry }) => entry)
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Desviación estándar muestral (n − 1); con un solo valor → 0. */
function sampleStdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
