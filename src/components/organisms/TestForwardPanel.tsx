import { useState } from 'react'
import { describeError } from '@/components/utils/errorText'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { TestForwardSession } from '@/domain/testforward/session'
import { DEFAULT_PARAMS, Params, validate } from '@/components/utils/backtestForm'
import { Field } from '@/components/atoms/Field'
import { Button } from '@/components/atoms/Button'
import { Hint } from '@/components/atoms/Hint'

export interface TestForwardPanelProps {
  candles: readonly Candle[]
  /** Para la anualización del Sharpe de la sesión. */
  timeframe: Timeframe
  /** Estrategia activa (§1.9); indicadores, reglas y precios viven en la spec. */
  strategy: StrategySpec | null
  /** Nueva sesión (§2.3): el gráfico se corta y se abre su pestaña. */
  onStart: (session: TestForwardSession) => void
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
        <Hint data-testid="tf-empty">
          Sin velas: descarga o importa datos para ejecutar un test-forward.
        </Hint>
      )}

      {strategy === null ? (
        <Hint data-testid="tf-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </Hint>
      ) : (
        <Hint data-testid="tf-strategy-hint">
          Estrategia: {strategy.name}@{strategy.version}
        </Hint>
      )}

      <div className="panel-form">
        <Field label="Capital inicial">
          <input
            type="number"
            min={0}
            step="any"
            value={params.capital}
            onChange={(event) => update('capital', event.target.value)}
          />
        </Field>
        <Field label="Comisión (bps)">
          <input
            type="number"
            min={0}
            step="any"
            value={params.feeBps}
            onChange={(event) => update('feeBps', event.target.value)}
          />
        </Field>
        <Field label="Slippage (bps)">
          <input
            type="number"
            min={0}
            step="any"
            value={params.slippageBps}
            onChange={(event) => update('slippageBps', event.target.value)}
          />
        </Field>
      </div>

      <Button onClick={handleStart} disabled={candles.length === 0 || strategy === null}>
        Iniciar sesión
      </Button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="tf-error">
          {error}
        </p>
      )}
    </section>
  )
}
