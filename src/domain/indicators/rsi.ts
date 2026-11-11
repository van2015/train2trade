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
    const state = new RsiAccumulator(this.period)
    return sortedByTime(candles).map((candle) => ({
      time: candle.time,
      value: state.next(candle.close),
    }))
  }
}

/** Estado del cálculo: siembra de las primeras medias y después suavizado de Wilder. */
class RsiAccumulator {
  private previousClose: number | null = null
  private changeCount = 0
  private seedGain = 0
  private seedLoss = 0
  private avgGain = 0
  private avgLoss = 0

  constructor(private readonly period: number) {}

  /** RSI de la vela; `null` durante el calentamiento. */
  next(close: number): number | null {
    if (this.previousClose === null) {
      this.previousClose = close
      return null
    }

    const change = close - this.previousClose
    this.previousClose = close
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    this.changeCount += 1

    if (this.changeCount < this.period) {
      this.seedGain += gain
      this.seedLoss += loss
      return null
    }

    if (this.changeCount === this.period) {
      this.avgGain = (this.seedGain + gain) / this.period
      this.avgLoss = (this.seedLoss + loss) / this.period
    } else {
      this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period
      this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period
    }

    return rsiFrom(this.avgGain, this.avgLoss)
  }
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}
