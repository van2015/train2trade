import { useState } from 'react'
import { compareExperiments, ComparisonField, rankBy } from '@/domain/backtest/compare'
import { ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { formatMetric, METRIC_ROWS } from './backtestForm'
import { formatChartTime } from './chartData'

export interface ExperimentHistoryPanelProps {
  /** Snapshots guardados (en `App`), en el orden del repositorio. */
  snapshots: readonly ExperimentSnapshot[]
  /** Borra los ids seleccionados que sigan en la lista. */
  onRemove: (ids: readonly string[]) => void
  onClear: () => void
}

/** Etiquetas de los campos comparables (§9/§12C) para el aviso de differences. */
const FIELD_LABELS: Record<ComparisonField, string> = {
  instrument: 'Instrumento',
  timeframe: 'Timeframe',
  period: 'Periodo',
  initialCapital: 'Capital inicial',
  execution: 'Ejecución',
  risk: 'Riesgo',
}

function periodText(period: { from: number; to: number }): string {
  return `${formatChartTime(period.from)} → ${formatChartTime(period.to)}`
}

/**
 * Historial de experimentos (Fase 6, §9, UI mínima): lista los snapshots
 * guardados, permite seleccionar varios para **compararlos**
 * (`compareExperiments` + `rankBy` con métrica elegible y aviso de
 * `differences`) y borrar selección o todo. La lógica de comparación vive en
 * el dominio; este componente solo pinta.
 */
export function ExperimentHistoryPanel({
  snapshots,
  onRemove,
  onClear,
}: ExperimentHistoryPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [metric, setMetric] = useState<keyof Metrics>('netProfit')

  const selectedSnapshots = snapshots.filter((snapshot) => selected.has(snapshot.id))
  const comparison = selectedSnapshots.length >= 2 ? compareExperiments(selectedSnapshots) : null
  const ranked = comparison !== null ? rankBy(comparison.rows, metric) : []
  const metricLabel = METRIC_ROWS.find((row) => row.key === metric)?.label ?? metric

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleRemove = () => onRemove(selectedSnapshots.map((snapshot) => snapshot.id))

  return (
    <section className="history-panel" aria-label="Historial">
      <h2 className="panel-title">Historial</h2>

      {snapshots.length === 0 ? (
        <p className="panel-hint" data-testid="history-empty">
          Sin experimentos: ejecuta un backtest o un test-forward para registrarlos aquí.
        </p>
      ) : (
        <div className="panel-scroll">
          <table className="lab-table" data-testid="history-table">
            <thead>
              <tr>
                <th scope="col">Sel.</th>
                <th scope="col">Estrategia</th>
                <th scope="col">Instrumento</th>
                <th scope="col">Timeframe</th>
                <th scope="col">Periodo</th>
                <th scope="col">ROI</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={snapshot.id}
                      checked={selected.has(snapshot.id)}
                      onChange={() => toggle(snapshot.id)}
                    />
                  </td>
                  <td>{snapshot.strategyId}</td>
                  <td>{snapshot.instrument ?? '—'}</td>
                  <td>{snapshot.timeframe}</td>
                  <td>{periodText(snapshot.period)}</td>
                  <td>{formatMetric(snapshot.metrics.roi, 'percent')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-actions">
        <button
          type="button"
          className="button"
          onClick={handleRemove}
          disabled={selectedSnapshots.length === 0}
        >
          Borrar selección
        </button>
        <button
          type="button"
          className="button"
          onClick={onClear}
          disabled={snapshots.length === 0}
        >
          Borrar todo
        </button>
      </div>

      {comparison !== null && (
        <div data-testid="history-comparison">
          <label className="field">
            <span>Métrica de ranking</span>
            <select
              value={metric}
              onChange={(event) => setMetric(event.target.value as keyof Metrics)}
            >
              {METRIC_ROWS.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>

          {comparison.differences.length > 0 && (
            <p className="panel-warning" data-testid="history-differences">
              Difieren {comparison.differences.map((field) => FIELD_LABELS[field]).join(', ')}: la
              comparación directa de métricas puede engañar.
            </p>
          )}

          <div className="panel-scroll">
            <table className="lab-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Estrategia</th>
                  <th scope="col">Instrumento</th>
                  <th scope="col">Timeframe</th>
                  <th scope="col">Periodo</th>
                  <th scope="col">{metricLabel}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>{row.strategyId}</td>
                    <td>{row.instrument ?? '—'}</td>
                    <td>{row.timeframe}</td>
                    <td>{periodText(row.period)}</td>
                    <td>
                      {formatMetric(
                        row.metrics[metric],
                        METRIC_ROWS.find((item) => item.key === metric)?.format ?? 'money',
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
