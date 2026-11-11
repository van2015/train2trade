import { Candle } from '@/domain/candles/candle'
import { assertPeriod, Indicator, IndicatorValue, sortedByTime } from './indicator'

/**
 * RSI con suavizado de Wilder sobre cierres. Precios planos (`avgLoss === 0`)
 * → 100 por convención.
 */
export class Rsi implements Indicator {
  readonly name = 'rsi'
  readonly period: number

  constructor(period: number) {
    this.period = assertPeriod(period)
  }

  calculate(candles: readonly Candle[]): IndicatorValue[] {
    const values: IndicatorValue[] = []
    let previousClose: number | null = null
    let changeCount = 0
    let seedGain = 0
    let seedLoss = 0
    let avgGain = 0
    let avgLoss = 0

    for (const candle of sortedByTime(candles)) {
      if (previousClose === null) {
        previousClose = candle.close
        values.push({ time: candle.time, value: null })
        continue
      }

      const change = candle.close - previousClose
      previousClose = candle.close
      const gain = Math.max(change, 0)
      const loss = Math.max(-change, 0)
      changeCount += 1

      if (changeCount < this.period) {
        seedGain += gain
        seedLoss += loss
        values.push({ time: candle.time, value: null })
        continue
      }

      if (changeCount === this.period) {
        avgGain = (seedGain + gain) / this.period
        avgLoss = (seedLoss + loss) / this.period
      } else {
        avgGain = (avgGain * (this.period - 1) + gain) / this.period
        avgLoss = (avgLoss * (this.period - 1) + loss) / this.period
      }

      values.push({ time: candle.time, value: rsiFrom(avgGain, avgLoss) })
    }

    return values
  }
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}
