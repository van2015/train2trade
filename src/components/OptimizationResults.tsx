import { OptimizationResult } from '@/domain/backtest/optimization'
import { RobustnessReport } from '@/domain/backtest/robustness'
import { sortByMetricDesc } from '@/domain/backtest/metrics'
import { formatMetric, METRIC_ROWS } from './backtestForm'

/** Estado mostrado por la pestaña Optimización (lo construye el formulario). */
export interface OptimizationViewState {
  optimization: OptimizationResult
  /** `null` si la métrica es null en todas las ejecuciones (`note` lo explica). */
  robustness: RobustnessReport | null
  note: string | null
}

export interface OptimizationResultsProps {
  /** Última optimización ejecutada; null → estado vacío. */
  view: OptimizationViewState | null
}

/**
 * Resultados de optimización en el área principal (plan UI, Fase 3): tabla de
 * runs ordenada con la semántica de `rankBy` + bloque de `RobustnessReport`.
 * Mismos `data-testid` que el antiguo bloque dentro de `OptimizationPanel`.
 */
export function OptimizationResults({ view }: OptimizationResultsProps) {
  if (view === null) {
    return (
      <section className="lab-results" aria-label="Resultados de la optimización">
        <p className="lab-results__empty" data-testid="opt-results-empty">
          Ejecuta una optimización para ver los resultados aquí.
        </p>
      </section>
    )
  }

  const runMetric = view.optimization.metric
  const metricRow = METRIC_ROWS.find((row) => row.key === runMetric)
  const metricLabel = metricRow?.label ?? runMetric
  const metricFormat = metricRow?.format ?? 'money'

  return (
    <section className="lab-results" aria-label="Resultados de la optimización">
      <div className="panel-scroll">
        <table className="lab-table" data-testid="opt-runs">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Combinación</th>
              <th scope="col">{metricLabel}</th>
              <th scope="col">Equity final</th>
              <th scope="col">Trades</th>
            </tr>
          </thead>
          <tbody>
            {sortByMetricDesc(view.optimization.runs, runMetric).map((run, index) => (
              <tr key={`${String(run.params.fast)}-${String(run.params.slow)}`}>
                <td>{index + 1}</td>
                <td>
                  fast {run.params.fast} · slow {run.params.slow}
                </td>
                <td>{formatMetric(run.metrics[runMetric], metricFormat)}</td>
                <td>{formatMetric(run.finalEquity, 'money')}</td>
                <td>{run.tradeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view.robustness !== null ? (
        <div className="panel-block" data-testid="opt-robustness">
          <p className="panel-subtitle">Robustez ({metricLabel})</p>
          <ul className="panel-list">
            <li>
              Válidas: {view.robustness.count} · Mejor{' '}
              {formatMetric(view.robustness.best, metricFormat)} · Peor{' '}
              {formatMetric(view.robustness.worst, metricFormat)} · Media{' '}
              {formatMetric(view.robustness.mean, metricFormat)} · Desv{' '}
              {formatMetric(view.robustness.stdev, metricFormat)}
            </li>
            <li>
              Plateau: {view.robustness.plateau.neighbors} vecinos · media{' '}
              {formatMetric(view.robustness.plateau.avg, metricFormat)} · peor{' '}
              {formatMetric(view.robustness.plateau.worst, metricFormat)}
            </li>
            <li>
              Sobre umbral {view.robustness.aboveThreshold.threshold}:{' '}
              {formatMetric(view.robustness.aboveThreshold.fraction, 'percent')} (
              {view.robustness.aboveThreshold.count})
            </li>
            <li>
              Sensibilidad:{' '}
              {view.robustness.sensitivity
                .map((entry) => `${entry.param} ${formatMetric(entry.spread, metricFormat)}`)
                .join(' · ')}
            </li>
          </ul>
        </div>
      ) : (
        view.note !== null && (
          <p className="panel-warning" data-testid="opt-note">
            {view.note}
          </p>
        )
      )}
    </section>
  )
}
