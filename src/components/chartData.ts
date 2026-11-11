import type {
  AreaData,
  CandlestickData,
  HistogramData,
  LineData,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts'
import { EquityPoint } from '@/domain/backtest/metrics'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { Ema } from '@/domain/indicators/ema'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'

/** Paleta del gráfico (tema oscuro). */
export const CHART_COLORS = {
  background: '#131722',
  grid: '#1e222d',
  text: '#d1d4dc',
  border: '#2a2e39',
  up: '#26a69a',
  down: '#ef5350',
  volumeUp: 'rgba(38, 166, 154, 0.5)',
  volumeDown: 'rgba(239, 83, 80, 0.5)',
  sma: '#2962ff',
  ema: '#ff9800',
  rsi: '#ab47bc',
  equity: '#7e57c2',
} as const

export type ChartLinePane = 'price' | 'lower'

export interface ChartLine {
  /** Identificador estable (`sma`, `ema`, `rsi`); la UI lo usa para sincronizar series. */
  id: string
  label: string
  color: string
  values: readonly IndicatorValue[]
  pane: ChartLinePane
  /** Rango fijo del eje de precios (p. ej. RSI 0–100) en vez de auto-escalado. */
  fixedRange?: { min: number; max: number }
  referenceLines?: readonly number[]
}

/** Timestamp Unix en ms → `UTCTimestamp` de lightweight-charts (segundos). */
export function toChartTime(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp
}

/** Timestamp Unix en ms → `"YYYY-MM-DD HH:mm"` en UTC (leyenda del gráfico). */
export function formatChartTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

/** Precio/volumen para la leyenda: hasta 8 decimales, sin notación científica. */
export function formatChartPrice(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function toCandlestickData(candles: readonly Candle[]): CandlestickData[] {
  return candles.map((candle) => ({
    time: toChartTime(candle.time),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }))
}

export function toVolumeData(candles: readonly Candle[]): HistogramData[] {
  return candles.map((candle) => ({
    time: toChartTime(candle.time),
    value: candle.volume,
    color: candle.isBullish ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
  }))
}

/**
 * Valores → línea. Los `null` (calentamiento) van como datos en blanco: si no,
 * la línea uniría los extremos con un segmento falso.
 */
export function toLineData(values: readonly IndicatorValue[]): (LineData | WhitespaceData)[] {
  return values.map((entry) =>
    entry.value === null
      ? { time: toChartTime(entry.time) }
      : { time: toChartTime(entry.time), value: entry.value },
  )
}

/** Curva de equity (backtest Fase 4) → serie de área. */
export function toEquityAreaData(points: readonly EquityPoint[]): AreaData[] {
  return points.map((point) => ({ time: toChartTime(point.time), value: point.equity }))
}

/** Precisión adaptada a la magnitud del último cierre (evita mostrar altcoins como `0.00`). */
export function priceFormatFor(lastClose: number): { precision: number; minMove: number } {
  const magnitude = Math.abs(lastClose)
  if (magnitude >= 1_000) return { precision: 2, minMove: 0.01 }
  if (magnitude >= 1) return { precision: 4, minMove: 0.0001 }
  if (magnitude >= 0.01) return { precision: 6, minMove: 0.000001 }
  return { precision: 8, minMove: 0.00000001 }
}

export interface IndicatorToggle {
  enabled: boolean
  /** Entero >= 1; garantizado por el panel de control. */
  period: number
}

export interface IndicatorSettings {
  sma: IndicatorToggle
  ema: IndicatorToggle
  rsi: IndicatorToggle
}

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
  sma: { enabled: true, period: 20 },
  ema: { enabled: false, period: 20 },
  rsi: { enabled: false, period: 14 },
}

/** Calcula las líneas de indicador activas (periodos inválidos → `InvalidPeriodError`). */
export function buildLines(candles: readonly Candle[], settings: IndicatorSettings): ChartLine[] {
  const lines: ChartLine[] = []

  if (settings.sma.enabled) {
    lines.push({
      id: 'sma',
      label: `SMA ${settings.sma.period}`,
      color: CHART_COLORS.sma,
      values: new Sma(settings.sma.period).calculate(candles),
      pane: 'price',
    })
  }

  if (settings.ema.enabled) {
    lines.push({
      id: 'ema',
      label: `EMA ${settings.ema.period}`,
      color: CHART_COLORS.ema,
      values: new Ema(settings.ema.period).calculate(candles),
      pane: 'price',
    })
  }

  if (settings.rsi.enabled) {
    lines.push({
      id: 'rsi',
      label: `RSI ${settings.rsi.period}`,
      color: CHART_COLORS.rsi,
      values: new Rsi(settings.rsi.period).calculate(candles),
      pane: 'lower',
      fixedRange: { min: 0, max: 100 },
      referenceLines: [30, 70],
    })
  }

  return lines
}
