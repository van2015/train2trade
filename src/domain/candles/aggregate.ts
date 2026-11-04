import { Candle } from './candle'
import { InvalidTimeframeError, Timeframe } from './timeframe'

/**
 * Agrupa velas por bucket de `timeframe` y devuelve la vela agregada de cada
 * bucket (la fusión OHLCV vive en `Candle.aggregate`).
 */
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (!Timeframe.is(timeframe)) {
    throw new InvalidTimeframeError(timeframe)
  }
  if (candles.length === 0) return []

  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const buckets = new Map<number, Candle[]>()

  for (const candle of sorted) {
    const bucketTime = Math.floor(candle.time / timeframe.ms) * timeframe.ms
    const group = buckets.get(bucketTime)
    if (group) {
      group.push(candle)
    } else {
      buckets.set(bucketTime, [candle])
    }
  }

  return [...buckets.values()].map((group) => Candle.aggregate(group, timeframe))
}
