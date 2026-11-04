import { InvalidTimeframeError, Timeframe } from './timeframe'
import type { Candle } from './types'

/**
 * Agrega velas de menor timeframe a mayor timeframe.
 * - time: inicio del bucket
 * - open: open de la primera vela del bucket
 * - close: close de la última vela del bucket
 * - high/low: extremos del bucket
 * - volume: suma
 */
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (!Timeframe.is(timeframe)) {
    throw new InvalidTimeframeError(timeframe)
  }
  if (candles.length === 0) return []

  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const buckets = new Map<number, Candle>()

  for (const candle of sorted) {
    const bucketTime = Math.floor(candle.time / timeframe.ms) * timeframe.ms
    const aggregated = buckets.get(bucketTime)

    if (aggregated === undefined) {
      // Primera vela del bucket: open/high/low/volume ya son los suyos.
      buckets.set(bucketTime, { ...candle, time: bucketTime })
    } else {
      aggregated.close = candle.close
      aggregated.high = Math.max(aggregated.high, candle.high)
      aggregated.low = Math.min(aggregated.low, candle.low)
      aggregated.volume += candle.volume
    }
  }

  return [...buckets.values()]
}
