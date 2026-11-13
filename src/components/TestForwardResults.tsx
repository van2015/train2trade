import { TestForwardRun } from '@/domain/backtest/testForward'
import { formatMetric, METRIC_ROWS } from './backtestForm'
import { formatChartTime } from './chartData'

export interface TestForwardResultsProps {
  /** Último test-forward ejecutado; null → estado vacío. */
  run: TestForwardRun | null
}

/**
 * Resultados de test-forward en el área principal (plan UI, Fase 3): resumen
 * dev/eval y tabla lado a lado con fila de deltas. Mismos `data-testid` que el
 * antiguo bloque dentro de `TestForwardPanel`.
 */
export function TestForwardResults({ run }: TestForwardResultsProps) {
  if (run === null) {
    return (
      <section className="lab-results" aria-label="Resultados del test-forward">
        <p className="lab-results__empty" data-testid="tf-results-empty">
          Ejecuta un test-forward para ver los resultados aquí.
        </p>
      </section>
    )
  }

  return (
    <section className="lab-results" aria-label="Resultados del test-forward">
      <p className="panel-summary lab-results__summary" data-testid="tf-summary">
        Corte {formatChartTime(run.cutTime)} · Desarrollo{' '}
        {formatChartTime(run.development.period.from)} →{' '}
        {formatChartTime(run.development.period.to)} · Evaluación{' '}
        {formatChartTime(run.evaluation.period.from)} → {formatChartTime(run.evaluation.period.to)}
      </p>

      <div className="panel-scroll">
        <table className="lab-table" data-testid="tf-table">
          <thead>
            <tr>
              <th scope="col">Métrica</th>
              <th scope="col">Desarrollo</th>
              <th scope="col">Evaluación</th>
              <th scope="col">Δ</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map((row) => {
              const development = run.development.result.metrics[row.key]
              const evaluation = run.evaluation.result.metrics[row.key]
              const delta = run.deltas[row.key]
              return (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{formatMetric(development, row.format)}</td>
                  <td>{formatMetric(evaluation, row.format)}</td>
                  <td>{delta === undefined ? '—' : formatMetric(delta, row.format)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
