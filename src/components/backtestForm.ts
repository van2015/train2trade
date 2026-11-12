import { Metrics } from '@/domain/backtest/metrics'
import { formatChartPrice } from './chartData'

/**
 * Formulario y controles compartidos de los paneles (Fase 6): parámetros del
 * backtest (Backtest, Replay y Test-Forward reutilizan `validate`) y las
 * filas/formato de métricas (tablas de resultados, ranking y optimización).
 * Fuente única: `BacktestPanel` dejó de definirlos localmente.
 */
export interface Params {
  capital: string
  feeBps: string
  slippageBps: string
  fast: string
  slow: string
}

export const DEFAULT_PARAMS: Params = {
  capital: '1000',
  feeBps: '0',
  slippageBps: '0',
  fast: '10',
  slow: '30',
}

export type ValidationResult =
  | { ok: true; capital: number; feeBps: number; slippageBps: number; fast: number; slow: number }
  | { ok: false; error: string }

/** Valida los campos del formulario (capital > 0, bps >= 0, periodos enteros >= 1). */
export function validate(params: Params): ValidationResult {
  const capital = Number(params.capital)
  if (params.capital.trim() === '' || !Number.isFinite(capital) || capital <= 0) {
    return { ok: false, error: 'Capital inicial: debe ser un número mayor que 0' }
  }

  const feeBps = Number(params.feeBps)
  if (params.feeBps.trim() === '' || !Number.isFinite(feeBps) || feeBps < 0) {
    return { ok: false, error: 'Comisión (bps): debe ser un número >= 0' }
  }

  const slippageBps = Number(params.slippageBps)
  if (params.slippageBps.trim() === '' || !Number.isFinite(slippageBps) || slippageBps < 0) {
    return { ok: false, error: 'Slippage (bps): debe ser un número >= 0' }
  }

  const fast = Number(params.fast)
  if (!Number.isInteger(fast) || fast < 1) {
    return { ok: false, error: 'SMA rápida: debe ser un entero >= 1' }
  }

  const slow = Number(params.slow)
  if (!Number.isInteger(slow) || slow < 1) {
    return { ok: false, error: 'SMA lenta: debe ser un entero >= 1' }
  }

  return { ok: true, capital, feeBps, slippageBps, fast, slow }
}

/** Fila de métrica: clave, etiqueta en español y formato de visualización. */
export interface MetricRow {
  key: keyof Metrics
  label: string
  format: 'money' | 'percent' | 'ratio'
}

/** Conjunto mínimo de métricas (§9, Fase 4) en el orden de presentación. */
export const METRIC_ROWS: readonly MetricRow[] = [
  { key: 'netProfit', label: 'Beneficio neto', format: 'money' },
  { key: 'roi', label: 'ROI', format: 'percent' },
  { key: 'maxDrawdown', label: 'Drawdown máximo', format: 'percent' },
  { key: 'sharpe', label: 'Sharpe', format: 'ratio' },
  { key: 'profitFactor', label: 'Profit factor', format: 'ratio' },
  { key: 'winRate', label: 'Win rate', format: 'percent' },
  { key: 'avgTrade', label: 'Trade medio', format: 'money' },
  { key: 'expectancy', label: 'Expectancy', format: 'money' },
]

/** Formato de una métrica: `—` en null, porcentaje, ratio (±∞) o precio. */
export function formatMetric(value: number | null, format: MetricRow['format']): string {
  if (value === null) return '—'
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`
  if (format === 'ratio') {
    return Number.isFinite(value) ? value.toFixed(2) : value > 0 ? '∞' : '-∞'
  }
  return formatChartPrice(value)
}
