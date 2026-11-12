import { BacktestConfig, runBacktest } from '@/domain/backtest/backtest'
import { Metrics, sortByMetricDesc } from '@/domain/backtest/metrics'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Strategy } from '@/domain/strategies/strategy'
import { canonicalJson } from '@/domain/strategies/fingerprint'

/** Construye la estrategia de una combinación de parámetros (p. ej. periodos SMA). */
export type StrategyFactory = (params: Readonly<Record<string, number>>) => Strategy

export class OptimizationError extends DomainError {
  constructor(reason: string, raw?: unknown, cause?: unknown) {
    super(
      'OptimizationError',
      invalidMessage('Optimización inválida', reason, raw),
      cause !== undefined ? { cause } : undefined,
    )
  }
}

export interface OptimizationConfig {
  buildStrategy: StrategyFactory
  /** Nombre → valores; combinaciones en orden lexicográfico siguiendo el orden de claves. */
  grid: Readonly<Record<string, readonly number[]>>
  /** Métrica a optimizar (mayor es mejor; `null` al final). */
  metric: keyof Metrics
  /** BacktestConfig sin `strategy` (la fabrica `buildStrategy` por combinación). */
  base: Omit<BacktestConfig, 'strategy'>
}

export interface OptimizationRun {
  params: Readonly<Record<string, number>>
  metrics: Metrics
  finalEquity: number
  tradeCount: number
}

export interface OptimizationResult {
  grid: Readonly<Record<string, readonly number[]>>
  metric: keyof Metrics
  runs: readonly OptimizationRun[] // orden lexicográfico estable
  best: OptimizationRun
  worst: OptimizationRun
}

/** Cap de combinaciones (mismo espíritu que `MAX_CANDLES`); se rechaza antes de ejecutar. */
export const MAX_OPTIMIZATION_RUNS = 1000

/**
 * Grid search determinista (§13): producto cartesiano de `grid` en **orden
 * lexicográfico** (la última clave varía más rápido), un backtest por
 * combinación. Mismo grid → mismos runs, en el mismo orden (§12C).
 *
 * Cualquier fallo (rejilla inválida, `buildStrategy` o la propia ejecución)
 * aborta con `OptimizationError` **indicando los `params`** de la combinación
 * que falló: determinista, sin resultados parciales.
 *
 * `best`/`worst` usan la misma semántica que `rankBy` (`sortByMetricDesc`):
 * mayor valor primero, `null` al final — con lo que `worst` es el último de
 * esa ordenación (un `null` es el peor, salvo que todos lo sean).
 */
export function runOptimization(config: OptimizationConfig): OptimizationResult {
  const combos = buildCombos(config.grid)

  const runs: OptimizationRun[] = combos.map((params) => runOne(params, config))

  const sorted = sortByMetricDesc(runs, config.metric)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  // Inalcanzable: el producto cartesiano tiene al menos una combinación.
  if (best === undefined || worst === undefined) {
    throw new OptimizationError('la rejilla no produjo combinaciones', combos.length)
  }

  return { grid: config.grid, metric: config.metric, runs, best, worst }
}

/** Ejecuta una combinación; cualquier error → `OptimizationError` con sus `params`. */
function runOne(
  params: Readonly<Record<string, number>>,
  config: OptimizationConfig,
): OptimizationRun {
  try {
    const strategy = config.buildStrategy(params)
    const result = runBacktest({ ...config.base, strategy })
    return {
      params,
      metrics: result.metrics,
      finalEquity: result.finalEquity,
      tradeCount: result.trades.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new OptimizationError(
      `la combinación ${canonicalJson(params)} falló: ${message}`,
      params,
      error,
    )
  }
}

/**
 * Valida la rejilla (arrays no vacíos y cap respetado **antes** de ejecutar)
 * y devuelve las combinaciones en orden lexicográfico.
 */
function buildCombos(grid: Readonly<Record<string, readonly number[]>>): Record<string, number>[] {
  const keys = Object.keys(grid)
  const values: (readonly number[])[] = []
  let total = 1

  for (const key of keys) {
    const keyValues = grid[key]
    if (!Array.isArray(keyValues) || keyValues.length === 0) {
      throw new OptimizationError(`grid["${key}"] debe ser un array con al menos un valor`, key)
    }
    total *= keyValues.length
    if (total > MAX_OPTIMIZATION_RUNS) {
      throw new OptimizationError(
        `la rejilla supera las ${MAX_OPTIMIZATION_RUNS} combinaciones`,
        total,
      )
    }
    values.push(keyValues)
  }

  // Producto cartesiano: la última clave varía más rápido (orden lexicográfico).
  let combos: Record<string, number>[] = [{}]
  keys.forEach((key, position) => {
    const keyValues = values[position] ?? []
    combos = combos.flatMap((partial) => keyValues.map((value) => ({ ...partial, [key]: value })))
  })
  return combos
}
