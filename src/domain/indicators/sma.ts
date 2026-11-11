import { Candle } from '@/domain/candles/candle'
import { assertPeriod, Indicator, IndicatorValue, sortedByTime } from './indicator'

/** SMA sobre cierres; la ventana incluye la vela actual. */
export class Sma implements Indicator {
  readonly name = 'sma'
  readonly period: number

  constructor(period: number) {
    this.period = assertPeriod(period)
  }

  calculate(candles: readonly Candle[]): IndicatorValue[] {
    const values: IndicatorValue[] = []
    const window: number[] = []
    let sum = 0

    for (const candle of sortedByTime(candles)) {
      window.push(candle.close)
      sum += candle.close
      if (window.length > this.period) {
        const leaving = window.shift()
        if (leaving !== undefined) sum -= leaving
      }

      values.push({
        time: candle.time,
        value: window.length === this.period ? sum / this.period : null,
      })
    }

    return values
  }
}
