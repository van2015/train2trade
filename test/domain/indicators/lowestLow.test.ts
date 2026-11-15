import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { InvalidPeriodError } from '@/domain/indicators/indicator'
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

  it('produce null exactamente en los primeros period - 1 índices', () => {
    const result = values(4, [5, 4, 3, 2, 1, 0, 10])

    expect(result.slice(0, 3)).toEqual([null, null, null])
    expect(result.slice(3).every((value) => typeof value === 'number')).toBe(true)
  })

  it('la salida está alineada con la entrada: misma longitud y mismos time', () => {
    const candles = candlesFrom([7, 1, 9, 3, 5])
    const result = new LowestLow(2).calculate(candles)

    expect(result).toHaveLength(candles.length)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })

  it('la entrada vacía produce []', () => {
    expect(new LowestLow(3).calculate([])).toEqual([])
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

  it('lanza InvalidPeriodError con periodos inválidos', () => {
    for (const period of [0, -1, 2.5, NaN]) {
      expect(() => new LowestLow(period)).toThrow(InvalidPeriodError)
    }
  })

  it('el error tiene name InvalidPeriodError', () => {
    try {
      new LowestLow(0)
      throw new Error('debía lanzar InvalidPeriodError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPeriodError)
      expect((error as Error).name).toBe('InvalidPeriodError')
    }
  })

  it('no muta la entrada y ordena la salida si llega desordenada', () => {
    const candles = candlesFrom([1, 2, 3])
    const shuffled = [candles[2]!, candles[0]!, candles[1]!]
    const snapshot = [...shuffled]

    const result = new LowestLow(1).calculate(shuffled)

    expect(shuffled).toEqual(snapshot)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })
})
