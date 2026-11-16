import { describe, expect, it } from 'vitest'
import { Sma } from '@/domain/indicators/sma'
import { candlesFrom } from '../../support/candles'

function values(period: number, closes: number[]): (number | null)[] {
  return new Sma(period).calculate(candlesFrom(closes)).map((entry) => entry.value)
}

describe('Sma', () => {
  it('calcula la media sobre los últimos period cierres (ventana incluye la vela actual)', () => {
    expect(values(3, [1, 2, 3, 4, 5])).toEqual([null, null, 2, 3, 4])
  })

  it('Sma(1) devuelve la serie de cierres sin null', () => {
    expect(values(1, [3, 1, 4])).toEqual([3, 1, 4])
  })
})
