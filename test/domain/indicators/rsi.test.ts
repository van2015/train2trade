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

  it('las pérdidas alimentan el suavizado (semilla y Wilder)', () => {
    // [10, 9, 8, 9, 8]: dos caídas en semilla (avgLoss = 2/3) y una en actualización (7/9)
    const result = values(3, [10, 9, 8, 9, 8])

    expect(result.slice(0, 3)).toEqual([null, null, null])
    expect(result[3]).toBeCloseTo(33.3333, 3) // avgGain 1/3, avgLoss 2/3 → RS 0.5
    expect(result[4]).toBeCloseTo(22.2222, 3) // Wilder: avgLoss (2/3·2 + 1)/3 = 7/9

    // la caída cae justo en la vela que fija la semilla: avgLoss = (1 + 1)/3 = 2/3
    // (con la pérdida restando sería 0 → RSI 100 en lugar de 33,33)
    const seedLoss = values(3, [10, 11, 10, 9])
    expect(seedLoss[3]).toBeCloseTo(33.3333, 3)
  })
})
