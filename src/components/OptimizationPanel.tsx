import { useState } from 'react'
import {
  MAX_OPTIMIZATION_RUNS,
  OptimizationResult,
  runOptimization,
  StrategyFactory,
} from '@/domain/backtest/optimization'
import { analyzeRobustness, RobustnessReport } from '@/domain/backtest/robustness'
import { Metrics, sortByMetricDesc } from '@/domain/backtest/metrics'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { formatMetric, METRIC_ROWS } from './backtestForm'

export interface OptimizationPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
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

interface OptimizationViewState {
  optimization: OptimizationResult
  /** `null` si la métrica es null en todas las ejecuciones (`note` lo explica). */
  robustness: RobustnessReport | null
  note: string | null
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
 * Panel de optimización (Fase 6, §13, UI mínima): rangos de SMA rápida/lenta
 * (desde/hasta/paso) + métrica → rejilla con aviso de cap **antes** de
 * ejecutar, tabla de runs ordenada con la semántica de `rankBy` y bloque de
 * `RobustnessReport` (mejor, media, desv, plateau, sensibilidad). Sin
 * persistencia de runs (decisión de alcance): solo se muestran.
 */
export function OptimizationPanel({ candles, timeframe }: OptimizationPanelProps) {
  const [ranges, setRanges] = useState<RangeParams>(DEFAULT_RANGES)
  const [metric, setMetric] = useState<keyof Metrics>('netProfit')
  const [result, setResult] = useState<OptimizationViewState | null>(null)
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
      setResult(null)
      return
    }
    if (!slowRange.ok) {
      setError(slowRange.error)
      setResult(null)
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
      setResult({ optimization, robustness, note })
    } catch (caught) {
      setError(describeError(caught))
      setResult(null)
    }
  }

  const runMetric = result?.optimization.metric ?? metric
  const metricRow = METRIC_ROWS.find((row) => row.key === runMetric)
  const metricLabel = metricRow?.label ?? runMetric
  const metricFormat = metricRow?.format ?? 'money'

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

      {result !== null && (
        <>
          <div className="panel-scroll">
            <table className="lab-table" data-testid="opt-runs">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Combinación</th>
                  <th scope="col">{metricLabel}</th>
                  <th scope="col">Equity final</th>
                  <th scope="col">Trades</th>
                </tr>
              </thead>
              <tbody>
                {sortByMetricDesc(result.optimization.runs, runMetric).map((run, index) => (
                  <tr key={`${String(run.params.fast)}-${String(run.params.slow)}`}>
                    <td>{index + 1}</td>
                    <td>
                      fast {run.params.fast} · slow {run.params.slow}
                    </td>
                    <td>{formatMetric(run.metrics[runMetric], metricFormat)}</td>
                    <td>{formatMetric(run.finalEquity, 'money')}</td>
                    <td>{run.tradeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.robustness !== null ? (
            <div className="panel-block" data-testid="opt-robustness">
              <p className="panel-subtitle">Robustez ({metricLabel})</p>
              <ul className="panel-list">
                <li>
                  Válidas: {result.robustness.count} · Mejor{' '}
                  {formatMetric(result.robustness.best, metricFormat)} · Peor{' '}
                  {formatMetric(result.robustness.worst, metricFormat)} · Media{' '}
                  {formatMetric(result.robustness.mean, metricFormat)} · Desv{' '}
                  {formatMetric(result.robustness.stdev, metricFormat)}
                </li>
                <li>
                  Plateau: {result.robustness.plateau.neighbors} vecinos · media{' '}
                  {formatMetric(result.robustness.plateau.avg, metricFormat)} · peor{' '}
                  {formatMetric(result.robustness.plateau.worst, metricFormat)}
                </li>
                <li>
                  Sobre umbral {result.robustness.aboveThreshold.threshold}:{' '}
                  {formatMetric(result.robustness.aboveThreshold.fraction, 'percent')} (
                  {result.robustness.aboveThreshold.count})
                </li>
                <li>
                  Sensibilidad:{' '}
                  {result.robustness.sensitivity
                    .map((entry) => `${entry.param} ${formatMetric(entry.spread, metricFormat)}`)
                    .join(' · ')}
                </li>
              </ul>
            </div>
          ) : (
            result.note !== null && (
              <p className="panel-warning" data-testid="opt-note">
                {result.note}
              </p>
            )
          )}
        </>
      )}
    </section>
  )
}
