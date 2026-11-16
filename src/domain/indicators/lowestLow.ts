import { Candle } from '@/domain/candles/candle'
import {
  assertPeriod,
  Indicator,
  IndicatorValue,
  sortedByTime,
} from '@/domain/indicators/indicator'

/**
 * Mínimo `low` de los últimos `period` periodos (ventana incluye la vela
 * actual): el precio mínimo realmente negociado, tipo banda inferior de
 * Donchian. `null` durante el calentamiento, como el resto del catálogo.
 */
export class LowestLow implements Indicator {
  readonly name = 'lowestLow'
  readonly period: number

  constructor(period: number) {
    this.period = assertPeriod(period)
  }

  calculate(candles: readonly Candle[]): IndicatorValue[] {
    const values: IndicatorValue[] = []
    const window: number[] = []

    for (const candle of sortedByTime(candles)) {
      window.push(candle.low)
      if (window.length > this.period) window.shift()

      values.push({
        time: candle.time,
        value: window.length === this.period ? this.minOf(window) : null,
      })
    }

    return values
  }

  /**
   * Mínimo de la ventana por escaneo lineal (evita el spread de `Math.min` con
   * periodos grandes). El coste O(period) por vela es irrelevante: las series
   * están acotadas a `MAX_CANDLES` (1000).
   */
  private minOf(window: readonly number[]): number {
    let min = window[0] as number
    for (let index = 1; index < window.length; index += 1) {
      const value = window[index] as number
      if (value < min) min = value
    }
    return min
  }
}
