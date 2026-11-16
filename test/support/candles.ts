import { Candle } from '@/domain/candles/candle'

/**
 * Vela "típica" para fixtures: OHLC en torno al cierre (`open = close`,
 * `high = close + 1`, `low = close - 1`) y volumen 1. Los tests que necesitan
 * otra forma (rango fijo, lows distintos de los cierres, tiempo por índice…)
 * construyen su variante local.
 */
export function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

export interface CandleSeriesOptions {
  /** Timestamp de la primera vela (por defecto 1000). */
  startMs?: number
  /** Separación entre velas en ms (por defecto 60_000 = 1 min). */
  stepMs?: number
  /** Desplazamiento adicional sobre `startMs` (para derivar series de la misma base). */
  offsetMs?: number
}

/**
 * Serie de velas **planas** (`open = high = low = close = precio`, volumen 1) con
 * tiempos regulares `startMs + offsetMs + index * stepMs`. Los indicadores usan los
 * defaults; las sesiones de backtest/replay pasan su propio `startMs`/`stepMs`.
 */
export function candlesFrom(
  prices: readonly number[],
  { startMs = 1000, stepMs = 60_000, offsetMs = 0 }: CandleSeriesOptions = {},
): Candle[] {
  return prices.map((price, index) =>
    Candle.from({
      time: startMs + offsetMs + index * stepMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
    }),
  )
}
