import { useState } from 'react'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { DEFAULT_PARAMS, Params, validate } from './backtestForm'

export interface BacktestPanelProps {
  /** Velas cargadas en `App` (descarga o CSV); el backtest trabaja sobre ellas. */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento. */
  timeframe: Timeframe
  /** Instrumento registrado en el experimento (§12C). */
  instrument?: Instrument
  /** Auto-guardo (Fase 6): App lo guarda como snapshot en el historial. */
  onExperiment?: (experiment: Experiment) => void
  /** Último resultado (plan UI, T3): App lo muestra en la pestaña Backtest. */
  onResult?: (experiment: Experiment) => void
}

/**
 * Panel de backtest (Fase 4): parámetros + estrategia demo de cruce de SMA y
 * botón de ejecución. Los resultados se muestran en el área principal
 * (`BacktestResults`, plan UI T3); aquí solo viven el formulario y los errores.
 * Toda la lógica vive en el dominio (`Experiment.run`).
 */
export function BacktestPanel({
  candles,
  timeframe,
  instrument,
  onExperiment,
  onResult,
}: BacktestPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [closePositionAtEnd, setClosePositionAtEnd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: keyof Params, value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }))

  const handleRun = () => {
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
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
    </section>
  )
}
