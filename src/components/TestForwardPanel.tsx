import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { TestForwardRun, runTestForward } from '@/domain/backtest/testForward'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { DEFAULT_PARAMS, Params, validate } from './backtestForm'

export interface TestForwardPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
  /** Estrategia activa (selector único, §1.9); los indicadores/periodos viven en la spec. */
  strategy: StrategySpec | null
  /** Cada experimento ejecutado (desarrollo primero) → App lo guarda como snapshot. */
  onExperiment: (experiment: Experiment) => void
  /** Último run (plan UI, Fase 3): App lo muestra en la pestaña Test-Forward. */
  onResult?: (run: TestForwardRun) => void
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
 * Formulario de test-forward (Fase 6, §7C): parámetros + fecha de corte
 * (estrictamente dentro del rango de velas). Al ejecutar produce dos
 * experimentos **independientes**; los resultados (tabla dev/eval/Δ) se
 * muestran en el área principal (`TestForwardResults`, plan UI Fase 3).
 * La lógica vive en `runTestForward`; este componente solo valida y emite.
 */
export function TestForwardPanel({
  candles,
  timeframe,
  strategy,
  onExperiment,
  onResult,
}: TestForwardPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [cut, setCut] = useState('')
  const [error, setError] = useState<string | null>(null)

  const firstTime = candles[0]?.time
  const lastTime = candles[candles.length - 1]?.time

  const update = (key: keyof Params, value: string) =>
    setParams((previous) => ({ ...previous, [key]: value }))

  const handleRun = () => {
    if (strategy === null) return
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    const cutTime = parseCut(cut)
    if (cutTime === null) {
      setError('Corte: indica fecha y hora (UTC)')
      return
    }
    if (firstTime === undefined || lastTime === undefined) return // sin velas: botón deshabilitado
    if (cutTime <= firstTime || cutTime > lastTime) {
      setError('Corte: la fecha debe estar dentro del rango de velas')
      return
    }

    try {
      const run = runTestForward({
        strategy: buildStrategy(strategy),
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
        cutTime,
      })
      setError(null)
      onExperiment(run.development)
      onExperiment(run.evaluation)
      onResult?.(run)
    } catch (caught) {
      setError(describeError(caught))
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

      {strategy === null ? (
        <p className="panel-hint" data-testid="tf-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </p>
      ) : (
        <p className="panel-hint" data-testid="tf-strategy-hint">
          Estrategia: {strategy.name}@{strategy.version}
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

      <button
        type="button"
        className="button"
        onClick={handleRun}
        disabled={candles.length === 0 || strategy === null}
      >
        Ejecutar test-forward
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="tf-error">
          {error}
        </p>
      )}
    </section>
  )
}
