import { Candle } from '@/domain/candles/candle'
import { assertPeriod, Indicator, IndicatorValue, sortedByTime } from './indicator'

/** EMA sobre cierres; semilla = SMA de los primeros `period` cierres (no el primero). */
export class Ema implements Indicator {
  readonly name = 'ema'
  readonly period: number

  constructor(period: number) {
    this.period = assertPeriod(period)
  }

  calculate(candles: readonly Candle[]): IndicatorValue[] {
    const k = 2 / (this.period + 1)
    const values: IndicatorValue[] = []
    const window: number[] = []
    let sum = 0
    let previous: number | null = null

    for (const candle of sortedByTime(candles)) {
      window.push(candle.close)
      sum += candle.close
      if (window.length > this.period) {
        const leaving = window.shift()
        if (leaving !== undefined) sum -= leaving
      }

      let value: number | null = null
      if (window.length === this.period) {
        value = previous === null ? sum / this.period : candle.close * k + previous * (1 - k)
        previous = value
      }

      values.push({ time: candle.time, value })
    }

    return values
  }
}
