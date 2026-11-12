import { ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { canonicalJson } from '@/domain/strategies/fingerprint'

/**
 * Campos comparables entre experimentos (§9/§12C): si varían entre filas, la
 * comparación directa de métricas es engañosa → aviso de `differences`.
 * La **estrategia no se incluye**: variarla es el objeto de comparar.
 */
export type ComparisonField =
  'instrument' | 'timeframe' | 'period' | 'initialCapital' | 'execution' | 'risk'

/** Orden fijo de detección: hace determinista el orden de `differences`. */
const COMPARISON_FIELDS: readonly ComparisonField[] = [
  'instrument',
  'timeframe',
  'period',
  'initialCapital',
  'execution',
  'risk',
]

/** Fila de la tabla comparada: metadata + resultados, sin id de configuración redundante. */
export interface ComparisonRow {
  id: string
  strategyId: string
  instrument: string | null
  timeframe: string
  period: { from: number; to: number }
  initialCapital: number
  metrics: Metrics
  finalEquity: number
}

export interface ComparisonTable {
  rows: readonly ComparisonRow[]
  /** Campos que varían entre filas → aviso de no-comparabilidad directa (§12C). */
  differences: readonly ComparisonField[]
}

/**
 * Tabla comparada de snapshots (§9): filas en el orden de entrada y
 * `differences` con los campos cuyo valor no es idéntico en todas las filas
 * (0 o 1 fila → vacío). Determinista: misma entrada → misma tabla.
 */
export function compareExperiments(snapshots: readonly ExperimentSnapshot[]): ComparisonTable {
  const differences = COMPARISON_FIELDS.filter((field) => {
    const values = new Set(snapshots.map((snapshot) => canonicalJson(snapshot[field])))
    return values.size > 1
  })

  return { rows: snapshots.map(toRow), differences }
}

/**
 * Ranking descendente por métrica (§9): `null` al final (sin inventar orden
 * entre ellos más allá del de entrada) y **empates estables** — conservan el
 * orden de la lista original. No muta la entrada.
 */
export function rankBy(
  rows: readonly ComparisonRow[],
  metric: keyof Metrics,
): readonly ComparisonRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const before = a.row.metrics[metric]
      const after = b.row.metrics[metric]

      if (before === null && after === null) return a.index - b.index
      if (before === null) return 1 // nulls al final
      if (after === null) return -1
      if (before === after) return a.index - b.index // empate → orden de entrada
      return after - before // descendente
    })
    .map(({ row }) => row)
}

/** Proyecta un snapshot a su fila de comparación (copia defensiva del periodo). */
function toRow(snapshot: ExperimentSnapshot): ComparisonRow {
  return {
    id: snapshot.id,
    strategyId: snapshot.strategyId,
    instrument: snapshot.instrument,
    timeframe: snapshot.timeframe,
    period: { from: snapshot.period.from, to: snapshot.period.to },
    initialCapital: snapshot.initialCapital,
    metrics: snapshot.metrics,
    finalEquity: snapshot.finalEquity,
  }
}
