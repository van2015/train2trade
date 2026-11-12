import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { TestForwardRun, runTestForward } from '@/domain/backtest/testForward'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { DEFAULT_PARAMS, formatMetric, METRIC_ROWS, Params, validate } from './backtestForm'
import { formatChartTime } from './chartData'

export interface TestForwardPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
  /** Cada experimento ejecutado (desarrollo primero) → App lo guarda como snapshot. */
  onExperiment: (experiment: Experiment) => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `"YYYY-MM-DDTHH:mm"` (UTC) → instante; vacío/no parseable → null. */
function parseCut(value: string): number | null {
  if (value.trim() === '') return null
  const iso = value.length === 16 ? `${value}:00Z` : `${value}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** Instante → valor para `<input type="datetime-local">` en UTC. */
function toDateTimeLocal(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16)
}

/**
 * Panel de test-forward (Fase 6, §7C, UI mínima): formulario compartido +
 * fecha de corte (estrictamente dentro del rango de velas) → dos experimentos
 * **independientes** con tabla dev/eval lado a lado y fila de deltas. La
 * lógica vive en `runTestForward`; este componente solo valida y pinta.
 */
export function TestForwardPanel({ candles, timeframe, onExperiment }: TestForwardPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [cut, setCut] = useState('')
  const [result, setResult] = useState<TestForwardRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const firstTime = candles[0]?.time
  const lastTime = candles[candles.length - 1]?.time

  const update = (key: keyof Params, value: string) =>
    setParams((previous) => ({ ...previous, [key]: value }))

  const handleRun = () => {
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      setResult(null)
      return
    }

    const cutTime = parseCut(cut)
    if (cutTime === null) {
      setError('Corte: indica fecha y hora (UTC)')
      setResult(null)
      return
    }
    if (firstTime === undefined || lastTime === undefined) return // sin velas: botón deshabilitado
    if (cutTime <= firstTime || cutTime > lastTime) {
      setError('Corte: la fecha debe estar dentro del rango de velas')
      setResult(null)
      return
    }

    try {
      const run = runTestForward({
        strategy: new Strategy({
          name: 'sma-cross',
          indicators: { fast: new Sma(parsed.fast), slow: new Sma(parsed.slow) },
          signals: [
            new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
            new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
          ],
        }),
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
        cutTime,
      })
      setError(null)
      setResult(run)
      onExperiment(run.development)
      onExperiment(run.evaluation)
    } catch (caught) {
      setError(describeError(caught))
      setResult(null)
    }
  }

  return (
    <section className="testforward-panel" aria-label="Test-Forward">
      <h2 className="panel-title">Test-Forward</h2>

      {candles.length === 0 && (
        <p className="panel-hint" data-testid="tf-empty">
          Sin velas: descarga o importa datos para ejecutar un test-forward.
        </p>
      )}

      <div className="panel-form">
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
        <label className="field">
          <span>Corte (UTC)</span>
          <input
            type="datetime-local"
            value={cut}
            min={firstTime !== undefined ? toDateTimeLocal(firstTime) : undefined}
            max={lastTime !== undefined ? toDateTimeLocal(lastTime) : undefined}
            onChange={(event) => setCut(event.target.value)}
          />
        </label>
      </div>

      <button type="button" className="button" onClick={handleRun} disabled={candles.length === 0}>
        Ejecutar test-forward
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="tf-error">
          {error}
        </p>
      )}

      {result !== null && (
        <>
          <p className="panel-summary" data-testid="tf-summary">
            Corte {formatChartTime(result.cutTime)} · Desarrollo{' '}
            {formatChartTime(result.development.period.from)} →{' '}
            {formatChartTime(result.development.period.to)} · Evaluación{' '}
            {formatChartTime(result.evaluation.period.from)} →{' '}
            {formatChartTime(result.evaluation.period.to)}
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
                  const development = result.development.result.metrics[row.key]
                  const evaluation = result.evaluation.result.metrics[row.key]
                  const delta = result.deltas[row.key]
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
        </>
      )}
    </section>
  )
}
