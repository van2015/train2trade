import { useState } from 'react'
import {
  MAX_OPTIMIZATION_RUNS,
  runOptimization,
  StrategyFactory,
} from '@/domain/backtest/optimization'
import { analyzeRobustness, RobustnessReport } from '@/domain/backtest/robustness'
import { Metrics } from '@/domain/backtest/metrics'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { METRIC_ROWS } from './backtestForm'
import type { OptimizationViewState } from './OptimizationResults'

export interface OptimizationPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
  /** Última optimización (plan UI, Fase 3): App la muestra en su pestaña. */
  onResult?: (view: OptimizationViewState) => void
}

interface RangeParams {
  fastFrom: string
  fastTo: string
  fastStep: string
  slowFrom: string
  slowTo: string
  slowStep: string
}

const DEFAULT_RANGES: RangeParams = {
  fastFrom: '2',
  fastTo: '10',
  fastStep: '1',
  slowFrom: '5',
  slowTo: '40',
  slowStep: '5',
}

type RangeResult = { ok: true; values: number[] } | { ok: false; error: string }

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Enteros >= 1 de `from` a `to` con paso `step` (inclusive); error con el campo en el mensaje. */
function buildRange(
  fromValue: string,
  toValue: string,
  stepValue: string,
  label: string,
): RangeResult {
  const from = Number(fromValue)
  const to = Number(toValue)
  const step = Number(stepValue)

  if (fromValue.trim() === '' || !Number.isInteger(from) || from < 1) {
    return { ok: false, error: `${label} desde: debe ser un entero >= 1` }
  }
  if (toValue.trim() === '' || !Number.isInteger(to) || to < 1) {
    return { ok: false, error: `${label} hasta: debe ser un entero >= 1` }
  }
  if (stepValue.trim() === '' || !Number.isInteger(step) || step < 1) {
    return { ok: false, error: `${label} paso: debe ser un entero >= 1` }
  }
  if (from > to) {
    return { ok: false, error: `${label}: el "desde" no puede superar el "hasta"` }
  }

  const values: number[] = []
  for (let value = from; value <= to; value += step) values.push(value)
  return { ok: true, values }
}

/** Demo `sma-cross` (mismo patrón que BacktestPanel): el builder ignora el resto de claves. */
const buildStrategy: StrategyFactory = (params) =>
  new Strategy({
    name: 'sma-cross',
    indicators: { fast: new Sma(params.fast ?? 10), slow: new Sma(params.slow ?? 30) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })

/**
 * Formulario de optimización (Fase 6, §13): rangos de SMA rápida/lenta
 * (desde/hasta/paso) + métrica → rejilla con aviso de cap **antes** de
 * ejecutar. Al ejecutar produce la vista de resultados (runs ordenados +
 * `RobustnessReport`), que se muestra en el área principal
 * (`OptimizationResults`, plan UI Fase 3). Sin persistencia de runs
 * (decisión de alcance): solo se muestran.
 */
export function OptimizationPanel({ candles, timeframe, onResult }: OptimizationPanelProps) {
  const [ranges, setRanges] = useState<RangeParams>(DEFAULT_RANGES)
  const [metric, setMetric] = useState<keyof Metrics>('netProfit')
  const [error, setError] = useState<string | null>(null)

  const fastRange = buildRange(ranges.fastFrom, ranges.fastTo, ranges.fastStep, 'SMA rápida')
  const slowRange = buildRange(ranges.slowFrom, ranges.slowTo, ranges.slowStep, 'SMA lenta')
  const combos =
    fastRange.ok && slowRange.ok ? fastRange.values.length * slowRange.values.length : null
  const overCap = combos !== null && combos > MAX_OPTIMIZATION_RUNS

  const update = (key: keyof RangeParams, value: string) =>
    setRanges((previous) => ({ ...previous, [key]: value }))

  const handleRun = () => {
    if (!fastRange.ok) {
      setError(fastRange.error)
      return
    }
    if (!slowRange.ok) {
      setError(slowRange.error)
      return
    }

    try {
      const optimization = runOptimization({
        buildStrategy,
        grid: { fast: fastRange.values, slow: slowRange.values },
        metric,
        base: { candles, timeframe, initialCapital: 1_000 },
      })

      let robustness: RobustnessReport | null = null
      let note: string | null = null
      try {
        robustness = analyzeRobustness(optimization)
      } catch (caught) {
        note = describeError(caught)
      }

      setError(null)
      onResult?.({ optimization, robustness, note })
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  return (
    <section className="optimization-panel" aria-label="Optimización">
      <h2 className="panel-title">Optimización</h2>

      {candles.length === 0 && (
        <p className="panel-hint" data-testid="opt-empty">
          Sin velas: descarga o importa datos para ejecutar una optimización.
        </p>
      )}

      <div className="panel-form">
        <label className="field">
          <span>SMA rápida desde</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.fastFrom}
            onChange={(event) => update('fastFrom', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA rápida hasta</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.fastTo}
            onChange={(event) => update('fastTo', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA rápida paso</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.fastStep}
            onChange={(event) => update('fastStep', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA lenta desde</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.slowFrom}
            onChange={(event) => update('slowFrom', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA lenta hasta</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.slowTo}
            onChange={(event) => update('slowTo', event.target.value)}
          />
        </label>
        <label className="field">
          <span>SMA lenta paso</span>
          <input
            type="number"
            min={1}
            step={1}
            value={ranges.slowStep}
            onChange={(event) => update('slowStep', event.target.value)}
          />
        </label>
        <label className="field">
          <span>Métrica a optimizar</span>
          <select
            value={metric}
            onChange={(event) => setMetric(event.target.value as keyof Metrics)}
          >
            {METRIC_ROWS.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {overCap && (
        <p className="panel-warning" data-testid="opt-cap">
          {combos} combinaciones superan el máximo de {MAX_OPTIMIZATION_RUNS}: ajusta los rangos.
        </p>
      )}

      <button
        type="button"
        className="button"
        onClick={handleRun}
        disabled={candles.length === 0 || overCap}
      >
        Ejecutar optimización
      </button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="opt-error">
          {error}
        </p>
      )}
    </section>
  )
}
