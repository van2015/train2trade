import { describe, expect, it } from 'vitest'
import { Rsi } from '@/domain/indicators/rsi'
import { candlesFrom } from '../../support/candles'

function values(period: number, closes: number[]): (number | null)[] {
  return new Rsi(period).calculate(candlesFrom(closes)).map((entry) => entry.value)
}

describe('Rsi', () => {
  it('primer RSI en el índice period, con media de los primeros period cambios', () => {
    // cierres [10, 11, 10.5, 11, 11.5], period 3: cambios 1, -0.5, +0.5
    // avgGain = 1.5/3 = 0.5, avgLoss = 0.5/3 ≈ 0.1667 → RS = 3 → RSI = 75
    const result = values(3, [10, 11, 10.5, 11, 11.5])

    expect(result.slice(0, 3)).toEqual([null, null, null])
    expect(result[3]).toBeCloseTo(75, 6)
  })

  it('el segundo valor usa suavizado de Wilder, no media simple', () => {
    // Wilder: avgGain = (0.5*2 + 0.5)/3 = 0.5, avgLoss = (0.1667*2 + 0)/3 ≈ 0.1111
    // → RS = 4.5 → RSI ≈ 81.82 (media simple daría ≈ 66.67)
    const result = values(3, [10, 11, 10.5, 11, 11.5])

    expect(result[4]).toBeCloseTo(81.8182, 3)
    expect(result[4]).not.toBeCloseTo(66.6667, 0)
  })

  it('sin pérdidas netas → 100; solo pérdidas → 0; precios planos → 100', () => {
    expect(values(3, [10, 11, 12, 13])).toEqual([null, null, null, 100])
    expect(values(3, [10, 9, 8, 7])).toEqual([null, null, null, 0])
    expect(values(3, [5, 5, 5, 5])).toEqual([null, null, null, 100])
  })
})
