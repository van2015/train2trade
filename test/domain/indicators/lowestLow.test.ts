import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { LowestLow } from '@/domain/indicators/lowestLow'

/** Velas con `low` distinto de `close` para probar que se usa el mínimo real. */
function candlesFrom(lows: number[], startMs = 1000): Candle[] {
  return lows.map((low, index) =>
    Candle.from({
      time: startMs + index * 60_000,
      open: low + 5,
      high: low + 10,
      low,
      close: low + 3,
      volume: 1,
    }),
  )
}

function values(period: number, lows: number[]): (number | null)[] {
  return new LowestLow(period).calculate(candlesFrom(lows)).map((entry) => entry.value)
}

describe('LowestLow', () => {
  it('devuelve el mínimo low de los últimos period periodos (ventana con la vela actual)', () => {
    expect(values(3, [10, 8, 9, 7, 12])).toEqual([null, null, 8, 7, 7])
  })

  it('LowestLow(1) devuelve la serie de lows sin null', () => {
    expect(values(1, [3, 1, 4])).toEqual([3, 1, 4])
  })

  it('mira los lows, no los cierres', () => {
    // Cierres decrecientes pero con un low mínimo fuera de los cierres.
    const candles = [
      Candle.from({ time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1 }),
      Candle.from({ time: 160_000, open: 100, high: 110, low: 50, close: 104, volume: 1 }),
      Candle.from({ time: 220_000, open: 100, high: 110, low: 80, close: 103, volume: 1 }),
    ]

    expect(new LowestLow(3).calculate(candles).map((entry) => entry.value)).toEqual([
      null,
      null,
      50,
    ])
  })
})
