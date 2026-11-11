import { Candle } from './candle'
import { InvalidTimeframeError, Timeframe } from './timeframe'

/**
 * Agrupa por bucket de `timeframe` y devuelve la vela agregada de cada bucket,
 * en orden ascendente. El orden temporal de las velas dentro de cada bucket lo
 * decide `Candle.aggregate` (que ordena el grupo); aquí solo se ordenan las
 * claves de bucket.
 */
export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (!Timeframe.is(timeframe)) {
    throw new InvalidTimeframeError(timeframe)
  }
  if (candles.length === 0) return []

  const buckets = new Map<number, Candle[]>()

  for (const candle of candles) {
    const bucketTime = timeframe.bucketOf(candle.time)
    const group = buckets.get(bucketTime)
    if (group) {
      group.push(candle)
    } else {
      buckets.set(bucketTime, [candle])
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => Candle.aggregate(group, timeframe))
}
