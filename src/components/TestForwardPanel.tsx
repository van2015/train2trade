import { useState } from 'react'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { TestForwardSession } from '@/domain/testforward/session'
import { DEFAULT_PARAMS, Params, validate } from './backtestForm'

export interface TestForwardPanelProps {
  /** Velas cargadas en `App` (descarga o CSV); la sesión trabaja sobre ellas. */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe de la sesión. */
  timeframe: Timeframe
  /** Estrategia activa (selector único, §1.9); los indicadores/periodos viven en la spec. */
  strategy: StrategySpec | null
  /** Nueva sesión iniciada (§2.3): App la guarda, corta el gráfico y abre la pestaña. */
  onStart: (session: TestForwardSession) => void
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Formulario de test-forward interactivo (§2.3): estrategia activa +
 * capital/fee/slippage e **Iniciar sesión**. La sesión arranca con el salto
 * inicial al azar (§2.1.2) y su UI (tomar/descartar, paso, salto, TP/SL) vive
 * en la pestaña Test-Forward (`TestForwardSessionView`, patrón Replay). La
 * sesión **no** genera `ExperimentSnapshot` (decisiones humanas + `Math.random`,
 * riesgo §): sus resultados son el log y la equity en la pestaña.
 */
export function TestForwardPanel({ candles, timeframe, strategy, onStart }: TestForwardPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof Params, value: string) =>
    setParams((previous) => ({ ...previous, [key]: value }))

  const handleStart = () => {
    if (strategy === null) return
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    try {
      const session = new TestForwardSession({
        strategy: buildStrategy(strategy),
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
      })
      session.start() // salto inicial a un punto aleatorio (§2.1.2)
      setError(null)
      onStart(session)
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
      </div>

      <button
        type="button"
        className="button"
        onClick={handleStart}
        disabled={candles.length === 0 || strategy === null}
      >
        Iniciar sesión
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="tf-error">
          {error}
        </p>
      )}
    </section>
  )
}
