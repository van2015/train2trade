import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { EquityChart } from './EquityChart'
import { formatChartPrice, formatChartTime } from './chartData'

export interface BacktestPanelProps {
  /** Velas cargadas en `App` (descarga o CSV); el backtest trabaja sobre ellas. */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento. */
  timeframe: Timeframe
}

interface Params {
  capital: string
  feeBps: string
  slippageBps: string
  fast: string
  slow: string
}

const DEFAULT_PARAMS: Params = {
  capital: '1000',
  feeBps: '0',
  slippageBps: '0',
  fast: '10',
  slow: '30',
}

type ValidationResult =
  | { ok: true; capital: number; feeBps: number; slippageBps: number; fast: number; slow: number }
  | { ok: false; error: string }

function validate(params: Params): ValidationResult {
  const capital = Number(params.capital)
  if (params.capital.trim() === '' || !Number.isFinite(capital) || capital <= 0) {
    return { ok: false, error: 'Capital inicial: debe ser un número mayor que 0' }
  }

  const feeBps = Number(params.feeBps)
  if (params.feeBps.trim() === '' || !Number.isFinite(feeBps) || feeBps < 0) {
    return { ok: false, error: 'Comisión (bps): debe ser un número >= 0' }
  }

  const slippageBps = Number(params.slippageBps)
  if (params.slippageBps.trim() === '' || !Number.isFinite(slippageBps) || slippageBps < 0) {
    return { ok: false, error: 'Slippage (bps): debe ser un número >= 0' }
  }

  const fast = Number(params.fast)
  if (!Number.isInteger(fast) || fast < 1) {
    return { ok: false, error: 'SMA rápida: debe ser un entero >= 1' }
  }

  const slow = Number(params.slow)
  if (!Number.isInteger(slow) || slow < 1) {
    return { ok: false, error: 'SMA lenta: debe ser un entero >= 1' }
  }

  return { ok: true, capital, feeBps, slippageBps, fast, slow }
}

interface MetricRow {
  key: keyof Metrics
  label: string
  format: 'money' | 'percent' | 'ratio'
}

const METRIC_ROWS: readonly MetricRow[] = [
  { key: 'netProfit', label: 'Beneficio neto', format: 'money' },
  { key: 'roi', label: 'ROI', format: 'percent' },
  { key: 'maxDrawdown', label: 'Drawdown máximo', format: 'percent' },
  { key: 'sharpe', label: 'Sharpe', format: 'ratio' },
  { key: 'profitFactor', label: 'Profit factor', format: 'ratio' },
  { key: 'winRate', label: 'Win rate', format: 'percent' },
  { key: 'avgTrade', label: 'Trade medio', format: 'money' },
  { key: 'expectancy', label: 'Expectancy', format: 'money' },
]

function formatMetric(value: number | null, format: MetricRow['format']): string {
  if (value === null) return '—'
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`
  if (format === 'ratio') {
    return Number.isFinite(value) ? value.toFixed(2) : value > 0 ? '∞' : '-∞'
  }
  return formatChartPrice(value)
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
 * Panel de backtest (Fase 4, UI mínima): parámetros + estrategia demo de
 * cruce de SMA, botón de ejecución, tabla de métricas, equity curve y
 * resumen de trades. Toda la lógica vive en el dominio (`Experiment.run`).
 */
export function BacktestPanel({ candles, timeframe }: BacktestPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof Params, value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }))

  const handleRun = () => {
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      setExperiment(null)
      return
    }

    try {
      const strategy = new Strategy({
        name: 'sma-cross',
        indicators: { fast: new Sma(parsed.fast), slow: new Sma(parsed.slow) },
        signals: [
          new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
          new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
        ],
      })
      const next = Experiment.run({
        strategy,
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
        risk: { feeBps: parsed.feeBps, slippageBps: parsed.slippageBps },
      })
      setError(null)
      setExperiment(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setExperiment(null)
    }
  }

  const result = experiment?.result ?? null

  return (
    <section className="backtest-panel" aria-label="Backtest">
      <h2 className="panel-title">Backtest</h2>

      {candles.length === 0 && (
        <p className="backtest-panel__hint" data-testid="backtest-empty">
          Sin velas: descarga o importa datos para ejecutar un backtest.
        </p>
      )}

      <div className="backtest-form">
        <label className="field">
          <span>Capital inicial</span>
          <input
            type="number"
            min={0}
            step="any"
            value={params.capital}
            onChange={(event) => update('capital', event.target.value)}
          />
        </label>
        <label className="field">
          <span>Comisión (bps)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={params.feeBps}
            onChange={(event) => update('feeBps', event.target.value)}
          />
        </label>
        <label className="field">
          <span>Slippage (bps)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={params.slippageBps}
            onChange={(event) => update('slippageBps', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA rápida</span>
          <input
            type="number"
            min={1}
            step={1}
            value={params.fast}
            onChange={(event) => update('fast', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA lenta</span>
          <input
            type="number"
            min={1}
            step={1}
            value={params.slow}
            onChange={(event) => update('slow', event.target.value)}
          />
        </label>
      </div>

      <button type="button" className="button" onClick={handleRun} disabled={candles.length === 0}>
        Ejecutar backtest
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="backtest-error">
          {error}
        </p>
      )}

      {experiment !== null && result !== null && (
        <>
          <p className="backtest-summary" data-testid="backtest-summary">
            {experiment.strategyId} · {formatChartTime(experiment.period.from)} →{' '}
            {formatChartTime(experiment.period.to)} · {candles.length} velas ·{' '}
            {tradesSummary(result.trades)} · equity final {formatChartPrice(result.finalEquity)}
          </p>

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

          <EquityChart points={result.equityCurve} />

          {result.trades.length > 0 && (
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
          )}
        </>
      )}
    </section>
  )
}
