import { Experiment } from '@/domain/backtest/experiment'
import { Trade } from '@/domain/backtest/trade'
import { EquityChart } from './EquityChart'
import { formatMetric, METRIC_ROWS } from './backtestForm'
import { formatChartPrice, formatChartTime } from './chartData'

export interface BacktestResultsProps {
  /** Último backtest ejecutado; null → estado vacío. */
  experiment: Experiment | null
}

function tradesSummary(trades: readonly Trade[]): string {
  const wins = trades.filter((trade) => trade.win).length
  const losses = trades.length - wins
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return `${count(trades.length, 'trade', 'trades')} · ${count(wins, 'ganador', 'ganadores')} · ${count(
    losses,
    'perdedor',
    'perdedores',
  )}`
}

/**
 * Resultados de backtest en el área principal, a ancho completo (plan UI, T3):
 * resumen, tabla de métricas, equity curve y trades. Mismos `data-testid` que
 * el antiguo bloque dentro de `BacktestPanel`.
 */
export function BacktestResults({ experiment }: BacktestResultsProps) {
  if (experiment === null) {
    return (
      <section className="backtest-results" aria-label="Resultados del backtest">
        <p className="backtest-results__empty" data-testid="backtest-results-empty">
          Ejecuta un backtest para ver los resultados aquí.
        </p>
      </section>
    )
  }

  const result = experiment.result

  return (
    <section className="backtest-results" aria-label="Resultados del backtest">
      <p className="backtest-summary" data-testid="backtest-summary">
        {experiment.strategyId} · {formatChartTime(experiment.period.from)} →{' '}
        {formatChartTime(experiment.period.to)} · {tradesSummary(result.trades)} · equity final{' '}
        {formatChartPrice(result.finalEquity)}
      </p>

      <div className="backtest-results__grid">
        <table className="backtest-metrics" data-testid="backtest-metrics">
          <tbody>
            {METRIC_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{formatMetric(result.metrics[row.key], row.format)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="backtest-results__equity">
          <EquityChart points={result.equityCurve} />
        </div>
      </div>

      {result.trades.length > 0 && (
        <div className="backtest-results__trades panel-scroll">
          <table className="backtest-trades" data-testid="backtest-trades">
            <thead>
              <tr>
                <th scope="col">Entrada</th>
                <th scope="col">Salida</th>
                <th scope="col">PnL</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.map((trade, index) => (
                <tr key={`${trade.entryTime}-${index}`}>
                  <td>{formatChartTime(trade.entryTime)}</td>
                  <td>{formatChartTime(trade.exitTime)}</td>
                  <td>{formatChartPrice(trade.pnl)}</td>
                  <td className={trade.win ? 'is-up' : 'is-down'}>
                    {trade.win ? 'Ganancia' : 'Pérdida'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
