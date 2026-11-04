import type { Candle } from './types'

/**
 * Agrega velas de menor timeframe a mayor timeframe.
 * - time: inicio del bucket
 * - open: open de la primera vela del bucket
 * - close: close de la última vela del bucket
 * - high/low: extremos del bucket
 * - volume: suma
 */
export function aggregateCandles(candles: Candle[], timeframeMs: number): Candle[] {
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    throw new RangeError(`timeframeMs debe ser un número positivo, se recibió ${timeframeMs}`)
  }
  if (candles.length === 0) return []

  const sorted = [...candles].sort((a, b) => a.time - b.time)
  const buckets = new Map<number, Candle[]>()

  for (const candle of sorted) {
    const bucketTime = Math.floor(candle.time / timeframeMs) * timeframeMs
    const bucket = buckets.get(bucketTime)
    if (bucket) {
      bucket.push(candle)
    } else {
      buckets.set(bucketTime, [candle])
    }
  }

  return [...buckets.entries()].map(([bucketTime, group]) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    return {
      time: bucketTime,
      open: first.open,
      close: last.close,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    }
  })
}
