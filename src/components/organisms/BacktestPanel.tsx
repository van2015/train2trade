import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { DEFAULT_PARAMS, Params, validate } from '@/components/utils/backtestForm'
import { Field } from '@/components/atoms/Field'
import { Button } from '@/components/atoms/Button'
import { Hint } from '@/components/atoms/Hint'

export interface BacktestPanelProps {
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento. */
  timeframe: Timeframe
  /** Instrumento registrado en el experimento (§12C). */
  instrument?: Instrument
  /** Estrategia activa (§1.9); indicadores, reglas y precios viven en la spec. */
  strategy: StrategySpec | null
  /** Auto-guardo: se guarda como snapshot en el historial (§9/§12C). */
  onExperiment?: (experiment: Experiment) => void
  /** Resultado para la pestaña Backtest (auto-conmutación, T3). */
  onResult?: (experiment: Experiment) => void
}

/**
 * Panel de backtest (Fase 4): parámetros del experimento (capital/costes) y
 * botón de ejecución sobre la **estrategia activa** (§1.9): los indicadores,
 * reglas y precios viven en la `StrategySpec`, no en este formulario. Los
 * resultados se muestran en el área principal (`BacktestResults`); aquí solo
 * viven el formulario y los errores. Toda la lógica vive en el dominio
 * (`buildStrategy` + `Experiment.run`).
 */
export function BacktestPanel({
  candles,
  timeframe,
  instrument,
  strategy,
  onExperiment,
  onResult,
}: BacktestPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [closePositionAtEnd, setClosePositionAtEnd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof Params, value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }))

  const handleRun = () => {
    if (strategy === null) return
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    try {
      const next = Experiment.run({
        strategy: buildStrategy(strategy),
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
        instrument,
        closePositionAtEnd,
      })
      setError(null)
      onExperiment?.(next)
      onResult?.(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className="backtest-panel" aria-label="Backtest">
      <h2 className="panel-title">Backtest</h2>

      {candles.length === 0 && (
        <p className="backtest-panel__hint" data-testid="backtest-empty">
          Sin velas: descarga o importa datos para ejecutar un backtest.
        </p>
      )}

      {strategy === null ? (
        <Hint data-testid="backtest-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </Hint>
      ) : (
        <Hint data-testid="backtest-strategy-hint">
          Estrategia: {strategy.name}@{strategy.version}
        </Hint>
      )}

      <div className="backtest-form">
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

      <Field check label="Cerrar posición al final">
        <input
          type="checkbox"
          checked={closePositionAtEnd}
          onChange={(event) => setClosePositionAtEnd(event.target.checked)}
        />
      </Field>

      <Button onClick={handleRun} disabled={candles.length === 0 || strategy === null}>
        Ejecutar backtest
      </Button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="backtest-error">
          {error}
        </p>
      )}
    </section>
  )
}
