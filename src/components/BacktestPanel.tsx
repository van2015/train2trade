import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { DEFAULT_PARAMS, Params, validate } from './backtestForm'

export interface BacktestPanelProps {
  /** Velas cargadas en `App` (descarga o CSV); el backtest trabaja sobre ellas. */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento. */
  timeframe: Timeframe
  /** Instrumento registrado en el experimento (§12C). */
  instrument?: Instrument
  /** Estrategia activa (selector único, §1.9); los indicadores/periodos viven en la spec. */
  strategy: StrategySpec | null
  /** Auto-guardo (Fase 6): App lo guarda como snapshot en el historial. */
  onExperiment?: (experiment: Experiment) => void
  /** Último resultado (plan UI, T3): App lo muestra en la pestaña Backtest. */
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
        <p className="panel-hint" data-testid="backtest-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </p>
      ) : (
        <p className="panel-hint" data-testid="backtest-strategy-hint">
          Estrategia: {strategy.name}@{strategy.version}
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

      <button
        type="button"
        className="button"
        onClick={handleRun}
        disabled={candles.length === 0 || strategy === null}
      >
        Ejecutar backtest
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="backtest-error">
          {error}
        </p>
      )}
    </section>
  )
}
