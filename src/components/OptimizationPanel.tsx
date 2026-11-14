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
import { buildStrategy, IndicatorSpec, StrategySpec } from '@/domain/strategies/spec'
import { METRIC_ROWS } from './backtestForm'
import type { OptimizationViewState } from './OptimizationResults'

export interface OptimizationPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
  /** Estrategia activa (selector único, §1.9): el grid varía sus indicadores con periodo. */
  strategy: StrategySpec | null
  /** Última optimización (plan UI, Fase 3): App la muestra en su pestaña. */
  onResult?: (view: OptimizationViewState) => void
}

interface RangeFields {
  from: string
  to: string
  step: string
}

/** Rangos por alias de indicador; los ausentes usan los defaults centrados en el periodo. */
type RangeState = Record<string, RangeFields>

type RangeResult = { ok: true; values: number[] } | { ok: false; error: string }

/** Indicadores con periodo optimizable (SMA/EMA/RSI; no las constantes). */
function parametricIndicators(
  spec: StrategySpec | null,
): readonly { alias: string; period: number }[] {
  return (spec?.indicators ?? [])
    .filter((indicator): indicator is Extract<IndicatorSpec, { period: number }> => {
      return indicator.kind !== 'const'
    })
    .map(({ alias, period }) => ({ alias, period }))
}

/** Rango por defecto centrado en el periodo declarado (±4 con paso 1). */
function defaultRange(period: number): RangeFields {
  return { from: String(Math.max(1, period - 4)), to: String(period + 4), step: '1' }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reúne los values por alias; el primer rango inválido aborta con su error. */
function checkRanges(
  results: readonly { alias: string; result: RangeResult }[],
): { ok: true; grid: Record<string, number[]> } | { ok: false; error: string } {
  const grid: Record<string, number[]> = {}
  for (const entry of results) {
    if (!entry.result.ok) return { ok: false, error: entry.result.error }
    grid[entry.alias] = entry.result.values
  }
  return { ok: true, grid }
}

/** Enteros >= 1 de `from` a `to` con paso `step` (inclusive); error con el campo en el mensaje. */
function buildRange(fields: RangeFields, label: string): RangeResult {
  const from = Number(fields.from)
  const to = Number(fields.to)
  const step = Number(fields.step)

  if (fields.from.trim() === '' || !Number.isInteger(from) || from < 1) {
    return { ok: false, error: `${label} desde: debe ser un entero >= 1` }
  }
  if (fields.to.trim() === '' || !Number.isInteger(to) || to < 1) {
    return { ok: false, error: `${label} hasta: debe ser un entero >= 1` }
  }
  if (fields.step.trim() === '' || !Number.isInteger(step) || step < 1) {
    return { ok: false, error: `${label} paso: debe ser un entero >= 1` }
  }
  if (from > to) {
    return { ok: false, error: `${label}: el "desde" no puede superar el "hasta"` }
  }

  const values: number[] = []
  for (let value = from; value <= to; value += step) values.push(value)
  return { ok: true, values }
}

/**
 * Formulario de optimización (Fase 6, §13): **un rango por indicador con
 * periodo** de la estrategia activa (§1.9) + métrica → rejilla con aviso de
 * cap **antes** de ejecutar. La fábrica sustituye los periodos de la spec
 * elegida por los de la rejilla (las constantes y el resto de la estructura —
 * reglas, TP/SL, triggers — se conservan). Al ejecutar produce la vista de
 * resultados (runs ordenados + `RobustnessReport`) en el área principal.
 * Sin persistencia de runs (decisión de alcance): solo se muestran.
 */
export function OptimizationPanel({
  candles,
  timeframe,
  strategy,
  onResult,
}: OptimizationPanelProps) {
  const [ranges, setRanges] = useState<RangeState>({})
  const [metric, setMetric] = useState<keyof Metrics>('netProfit')
  const [error, setError] = useState<string | null>(null)

  const parametric = parametricIndicators(strategy)
  const results = parametric.map(({ alias, period }) => ({
    alias,
    result: buildRange(ranges[alias] ?? defaultRange(period), alias),
  }))
  const rangeCheck = checkRanges(results)
  const combos = rangeCheck.ok
    ? Object.values(rangeCheck.grid).reduce((total, list) => total * list.length, 1)
    : null
  const overCap = combos !== null && combos > MAX_OPTIMIZATION_RUNS
  const noParams = strategy !== null && parametric.length === 0

  const update = (alias: string, period: number, key: keyof RangeFields, value: string) =>
    setRanges((previous) => ({
      ...previous,
      [alias]: { ...(previous[alias] ?? defaultRange(period)), [key]: value },
    }))

  const handleRun = () => {
    if (strategy === null) return
    if (!rangeCheck.ok) {
      setError(rangeCheck.error)
      return
    }

    /** Sustituye los periodos de la spec elegida por los de la rejilla (§13). */
    const strategyFactory: StrategyFactory = (params) =>
      buildStrategy({
        ...strategy,
        indicators: strategy.indicators.map((indicator) => {
          if (indicator.kind === 'const') return indicator
          const period = params[indicator.alias]
          return typeof period === 'number' ? { ...indicator, period } : indicator
        }),
      })

    try {
      const optimization = runOptimization({
        buildStrategy: strategyFactory,
        grid: rangeCheck.grid,
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

      {strategy === null && (
        <p className="panel-hint" data-testid="opt-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </p>
      )}

      {noParams && (
        <p className="panel-hint" data-testid="opt-no-params">
          La estrategia no tiene indicadores con periodo que optimizar.
        </p>
      )}

      <div className="panel-form">
        {parametric.map(({ alias, period }) => {
          const fields = ranges[alias] ?? defaultRange(period)
          return (
            <label className="field" key={alias}>
              <span>{alias} desde</span>
              <input
                type="number"
                min={1}
                step={1}
                value={fields.from}
                onChange={(event) => update(alias, period, 'from', event.target.value)}
              />
            </label>
          )
        })}
        {parametric.map(({ alias, period }) => {
          const fields = ranges[alias] ?? defaultRange(period)
          return (
            <label className="field" key={`${alias}-hasta`}>
              <span>{alias} hasta</span>
              <input
                type="number"
                min={1}
                step={1}
                value={fields.to}
                onChange={(event) => update(alias, period, 'to', event.target.value)}
              />
            </label>
          )
        })}
        {parametric.map(({ alias, period }) => {
          const fields = ranges[alias] ?? defaultRange(period)
          return (
            <label className="field" key={`${alias}-paso`}>
              <span>{alias} paso</span>
              <input
                type="number"
                min={1}
                step={1}
                value={fields.step}
                onChange={(event) => update(alias, period, 'step', event.target.value)}
              />
            </label>
          )
        })}
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
        disabled={candles.length === 0 || strategy === null || overCap || noParams}
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
