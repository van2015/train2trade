import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { EquityChart } from './EquityChart'
import { DEFAULT_PARAMS, formatMetric, METRIC_ROWS, Params, validate } from './backtestForm'
import { formatChartPrice, formatChartTime } from './chartData'

export interface BacktestPanelProps {
  /** Velas cargadas en `App` (descarga o CSV); el backtest trabaja sobre ellas. */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento. */
  timeframe: Timeframe
  /** Instrumento registrado en el experimento (§12C). */
  instrument?: Instrument
  /** Auto-guardo (Fase 6): App lo guarda como snapshot en el historial. */
  onExperiment?: (experiment: Experiment) => void
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
export function BacktestPanel({
  candles,
  timeframe,
  instrument,
  onExperiment,
}: BacktestPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [experiment, setExperiment] = useState<Experiment | null>(null)
  const [closePositionAtEnd, setClosePositionAtEnd] = useState(false)
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
        instrument,
        closePositionAtEnd,
      })
      setError(null)
      setExperiment(next)
      onExperiment?.(next)
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

      <div className="field field--check">
        <label>
          <input
            type="checkbox"
            checked={closePositionAtEnd}
            onChange={(event) => setClosePositionAtEnd(event.target.checked)}
          />
          Cerrar posición al final
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
