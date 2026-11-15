import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext } from '@/domain/strategies/marketContext'
import { evaluatePriceExpr, PriceExpr } from '@/domain/strategies/priceExpr'
import { buildIndicator, IndicatorSpec, StrategySpec } from '@/domain/strategies/spec'
import { CHART_COLORS, ChartLine, ChartLinePane } from './chartData'

/**
 * Previsualización del editor de estrategias (plan `strategy-preview-plan.md`):
 * módulo **puro** (patrón `chartData.ts`) que traduce un draft a lo dibujable —
 * velas + indicadores + niveles de operación evaluados en la última vela.
 *
 * No ejecuta nada: ni `buildStrategy` (un draft con reglas rotas sigue
 * previsualizable) ni backtest (sin capital/comisiones: el preview es una
 * propiedad de la estrategia, §14). Los indicadores y expresiones se evalúan
 * **uno a uno** con try/catch: lo roto se omite y se enumera en `issues`.
 */

/** Nivel horizontal evaluado en la última vela (sin histórico: `OperationLevels`). */
export interface PreviewLevel {
  /** Estable para sincronizar `IPriceLine`: `entry` | `tp` | `sl` | `trigger-N`. */
  id: string
  /** Etiqueta en el eje de precios. */
  label: string
  price: number
  color: string
}

export interface StrategyPreview {
  /** Ventana visible (sufijo de las velas): la que hay que pintar. */
  window: PreviewWindow
  lines: ChartLine[]
  levels: PreviewLevel[]
  /** `"últimas 90 velas · SMA 30"` (driver = mayor período); null sin velas. */
  legend: string | null
  /** Qué se omitió (`Omitidos: …`) o `"Sin datos para previsualizar"`; null = todo visible. */
  note: string | null
}

/** Sufijo visible de las velas `[from, to)`: la ventana del preview. */
export interface PreviewWindow {
  from: number
  to: number
}

export interface PreviewLines {
  lines: ChartLine[]
  issues: string[]
}

export interface PreviewLevels {
  levels: PreviewLevel[]
  issues: string[]
}

const DEFAULT_WINDOW = 120
const MIN_WINDOW = 60
const MAX_WINDOW = 300

/**
 * Ventana ajustada a la estrategia: últimas `clamp(3 × máximo período, 60, 300)`
 * velas (120 si no hay períodos válidos). Períodos inválidos de un draft a
 * medio escribir (0, NaN, negativos) **no cuentan**: no rompen la ventana.
 */
export function previewWindow(candles: readonly Candle[], spec: StrategySpec): PreviewWindow {
  return { from: Math.max(0, candles.length - windowTarget(spec)), to: candles.length }
}

/** Períodos enteros ≥ 1 de los indicadores que tienen (los `const` no). */
function validPeriods(spec: StrategySpec): number[] {
  const periods: number[] = []
  for (const indicator of spec.indicators) {
    if (indicator.kind === 'const') continue
    if (Number.isInteger(indicator.period) && indicator.period >= 1) {
      periods.push(indicator.period)
    }
  }
  return periods
}

function windowTarget(spec: StrategySpec): number {
  const periods = validPeriods(spec)
  if (periods.length === 0) return DEFAULT_WINDOW
  return Math.min(Math.max(Math.max(...periods) * 3, MIN_WINDOW), MAX_WINDOW)
}

/** Indicador determinante de la ventana (mayor período válido), p. ej. `"SMA 30"`. */
function windowDriver(spec: StrategySpec): string | null {
  let best: { kind: 'sma' | 'ema' | 'rsi'; period: number } | null = null
  for (const indicator of spec.indicators) {
    if (indicator.kind === 'const') continue
    if (!Number.isInteger(indicator.period) || indicator.period < 1) continue
    if (best === null || indicator.period > best.period) {
      best = { kind: indicator.kind, period: indicator.period }
    }
  }
  return best === null ? null : `${best.kind.toUpperCase()} ${best.period}`
}

function windowLegend(range: PreviewWindow, spec: StrategySpec): string | null {
  const length = range.to - range.from
  if (length === 0) return null
  const base = range.from > 0 ? `últimas ${length} velas` : `${length} velas`
  const driver = windowDriver(spec)
  return driver === null ? base : `${base} · ${driver}`
}

/** Color canónico por kind de indicador (misma paleta que el gráfico principal). */
const KIND_COLORS: Record<IndicatorSpec['kind'], string> = {
  sma: CHART_COLORS.sma,
  ema: CHART_COLORS.ema,
  rsi: CHART_COLORS.rsi,
  const: CHART_COLORS.constant,
}

/** Rotación para indicadores repetidos del mismo kind (p. ej. dos SMA). */
const EXTRA_COLORS: readonly string[] = [CHART_COLORS.equity, '#00bcd4', '#e91e63', '#ffd54f']

const LEVEL_COLORS = {
  entry: CHART_COLORS.sma,
  tp: CHART_COLORS.up,
  sl: CHART_COLORS.down,
  trigger: CHART_COLORS.ema,
} as const

/**
 * Líneas de indicador del draft: pane por kind (RSI → inferior con rango
 * 0–100; constante → según caiga en el rango de precios), color rotando entre
 * duplicados, `id` por **índice** de spec (los alias pueden duplicarse o estar
 * vacíos a medio editar). Un indicador inválido se omite con su issue.
 */
export function buildPreviewLines(candles: readonly Candle[], spec: StrategySpec): PreviewLines {
  const issues: string[] = []
  if (candles.length === 0) return { lines: [], issues }

  const lines: ChartLine[] = []
  const usedColors = new Set<string>()

  spec.indicators.forEach((indicator, index) => {
    let values: IndicatorValue[]
    try {
      values = buildIndicator(indicator).calculate(candles)
    } catch (error) {
      issues.push(indicatorIssue(indicator, index, error))
      return
    }

    const pane = linePane(indicator, candles)
    const line: ChartLine = {
      id: `indicator-${index}`,
      label: lineLabel(indicator),
      color: pickColor(indicator.kind, usedColors),
      values,
      pane,
    }
    if (indicator.kind === 'rsi') {
      line.fixedRange = { min: 0, max: 100 }
      line.referenceLines = [30, 70]
    } else if (indicator.kind === 'const' && pane === 'lower') {
      line.fixedRange = boundedRange(indicator.value)
    }
    lines.push(line)
  })

  return { lines, issues }
}

/**
 * Niveles de operación evaluados en la última vela: entrada límite (con su
 * precio), TP/SL con **entrada hipotética** (precio límite evaluado o cierre
 * actual) y triggers con los tres niveles disponibles. Cada evaluación es
 * individual: `null` o excepción ⇒ issue, sin romper el resto.
 */
export function buildPreviewLevels(candles: readonly Candle[], spec: StrategySpec): PreviewLevels {
  const issues: string[] = []
  if (candles.length === 0) return { levels: [], issues }

  // 1. Indicadores uno a uno: un periodo inválido no bloquea los demás.
  const indicators: Record<string, IndicatorValue[]> = {}
  spec.indicators.forEach((indicator, index) => {
    try {
      indicators[indicator.alias] = buildIndicator(indicator).calculate(candles)
    } catch (error) {
      issues.push(indicatorIssue(indicator, index, error))
    }
  })

  // 2. Contexto base (las velas deben venir ordenadas y normalizadas).
  let context: MarketContext
  try {
    context = MarketContext.from({ candles, indicators })
  } catch (error) {
    issues.push(`contexto: ${messageOf(error)}`)
    return { levels: [], issues }
  }

  const lastClose = candles[candles.length - 1]?.close
  if (lastClose === undefined) return { levels: [], issues } // inalcanzable (guard superior)

  const levels: PreviewLevel[] = []

  // 3. Entrada: solo `limit` tiene precio dibujable; la hipótesis para TP/SL
  //    es ese precio y, si no evalúa, el cierre actual (market → siempre).
  let entryHyp = lastClose
  if (spec.entry.execution === 'limit') {
    const price = evaluateLevel(spec.entry.price, context, 'entrada', issues)
    if (price !== null) {
      entryHyp = price
      levels.push({ id: 'entry', label: 'Entrada', price, color: LEVEL_COLORS.entry })
    }
  }
  const withEntry = context.withLevels({ entry: entryHyp })

  // 4. TP/SL con `entry` ya materializado (p. ej. `entry * 1.02`).
  let tp: number | null = null
  if (spec.takeProfit !== undefined) {
    tp = evaluateLevel(spec.takeProfit.price, withEntry, 'take profit', issues)
    if (tp !== null) {
      levels.push({ id: 'tp', label: 'Take profit', price: tp, color: LEVEL_COLORS.tp })
    }
  }
  let sl: number | null = null
  if (spec.stopLoss !== undefined) {
    sl = evaluateLevel(spec.stopLoss.price, withEntry, 'stop loss', issues)
    if (sl !== null) {
      levels.push({ id: 'sl', label: 'Stop loss', price: sl, color: LEVEL_COLORS.sl })
    }
  }
  const withLevels = withEntry.withLevels({ tp, sl })

  // 5. Triggers: pueden usar `entry`/`sl`/`tp` (§1.1).
  spec.triggers?.forEach((trigger, index) => {
    const price = evaluateLevel(trigger.price, withLevels, `trigger ${index + 1}`, issues)
    if (price !== null) {
      levels.push({
        id: `trigger-${index}`,
        label: `Trigger ${index + 1}`,
        price,
        color: LEVEL_COLORS.trigger,
      })
    }
  })

  return { levels, issues }
}

/**
 * Preview completo: ventana + líneas + niveles + leyenda + `note` con los
 * issues **deduplicados** (el mismo indicador roto falla al construir líneas y
 * niveles con el mismo mensaje). Sin velas ⇒ todo vacío con el note de datos.
 *
 * Las líneas se calculan sobre el historial **COMPLETO** y se recortan después
 * a la ventana: EMA/RSI tienen memoria (semilla de la vela 1) y calcularlos
 * sobre el trozo cortado los falsearía (hueco de calentamiento al inicio de la
 * ventana + valores distintos). Los niveles se evalúan en la última vela, que
 * siempre cae dentro de la ventana (es un sufijo).
 */
export function buildStrategyPreview(
  candles: readonly Candle[],
  spec: StrategySpec,
): StrategyPreview {
  const range = previewWindow(candles, spec)
  if (candles.length === 0) {
    return {
      window: range,
      lines: [],
      levels: [],
      legend: null,
      note: 'Sin datos para previsualizar',
    }
  }

  const { lines, issues: lineIssues } = buildPreviewLines(candles, spec)
  const { levels, issues: levelIssues } = buildPreviewLevels(candles, spec)
  const issues = [...new Set([...lineIssues, ...levelIssues])]

  return {
    window: range,
    lines: lines.map((line) => ({
      ...line,
      values: line.values.slice(range.from, range.to),
    })),
    levels,
    legend: windowLegend(range, spec),
    note: issues.length > 0 ? `Omitidos: ${issues.join(' · ')}` : null,
  }
}

/** Evaluación de un nivel con captura: `null` o excepción ⇒ issue + `null`. */
function evaluateLevel(
  expr: PriceExpr,
  context: MarketContext,
  label: string,
  issues: string[],
): number | null {
  try {
    const price = evaluatePriceExpr(expr, context)
    if (price === null) issues.push(`${label} no evaluable en la última vela`)
    return price
  } catch (error) {
    issues.push(`${label}: ${messageOf(error)}`)
    return null
  }
}

/** Issue de indicador inválido; alias vacío → posición `#N` (a medio editar). */
function indicatorIssue(spec: IndicatorSpec, index: number, error: unknown): string {
  return `indicador ${indicatorName(spec, index)}: ${messageOf(error)}`
}

function indicatorName(spec: IndicatorSpec, index: number): string {
  return spec.alias !== '' ? spec.alias : `#${index + 1}`
}

/** Label de línea: alias si tiene; si no, descripción del kind (`EMA 9`). */
function lineLabel(spec: IndicatorSpec): string {
  if (spec.alias !== '') return spec.alias
  if (spec.kind === 'const') return `Constante ${spec.value}`
  return `${spec.kind.toUpperCase()} ${spec.period}`
}

/** Primer color canónico no usado; paleta agotada → canónico aunque repita. */
function pickColor(kind: IndicatorSpec['kind'], used: Set<string>): string {
  for (const candidate of [KIND_COLORS[kind], ...EXTRA_COLORS]) {
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  return KIND_COLORS[kind]
}

/** Pane del indicador: RSI inferior; constante según caiga en el rango de precios. */
function linePane(spec: IndicatorSpec, candles: readonly Candle[]): ChartLinePane {
  if (spec.kind === 'rsi') return 'lower'
  if (spec.kind === 'const') return constPane(spec.value, candles)
  return 'price'
}

function constPane(value: number, candles: readonly Candle[]): ChartLinePane {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const candle of candles) {
    if (candle.low < min) min = candle.low
    if (candle.high > max) max = candle.high
  }
  return value >= min && value <= max ? 'price' : 'lower'
}

/** Rango fijo acotado para una constante sola en el panel inferior (±10%, o ±1). */
function boundedRange(value: number): { min: number; max: number } {
  const pad = Math.abs(value) * 0.1 || 1
  return { min: value - pad, max: value + pad }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
