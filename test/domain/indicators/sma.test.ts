import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { InvalidPeriodError } from '@/domain/indicators/indicator'
import { Sma } from '@/domain/indicators/sma'

function candlesFrom(closes: number[], startMs = 1000): Candle[] {
  return closes.map((close, index) =>
    Candle.from({
      time: startMs + index * 60_000,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }),
  )
}

function values(period: number, closes: number[]): (number | null)[] {
  return new Sma(period).calculate(candlesFrom(closes)).map((entry) => entry.value)
}

describe('Sma', () => {
  it('calcula la media sobre los últimos period cierres (ventana incluye la vela actual)', () => {
    expect(values(3, [1, 2, 3, 4, 5])).toEqual([null, null, 2, 3, 4])
  })

  it('produce null exactamente en los primeros period - 1 índices', () => {
    const result = values(4, [5, 4, 3, 2, 1, 0, 10])

    expect(result.slice(0, 3)).toEqual([null, null, null])
    expect(result.slice(3).every((value) => typeof value === 'number')).toBe(true)
  })

  it('la salida está alineada con la entrada: misma longitud y mismos time', () => {
    const candles = candlesFrom([7, 1, 9, 3, 5])
    const result = new Sma(2).calculate(candles)

    expect(result).toHaveLength(candles.length)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })

  it('la entrada vacía produce []', () => {
    expect(new Sma(3).calculate([])).toEqual([])
  })

  it('Sma(1) devuelve la serie de cierres sin null', () => {
    expect(values(1, [3, 1, 4])).toEqual([3, 1, 4])
  })

  it('lanza InvalidPeriodError con periodos inválidos', () => {
    for (const period of [0, -1, 2.5, NaN]) {
      expect(() => new Sma(period)).toThrow(InvalidPeriodError)
    }
  })

  it('el error tiene name InvalidPeriodError', () => {
    try {
      new Sma(0)
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

    const result = new Sma(1).calculate(shuffled)

    expect(shuffled).toEqual(snapshot)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })
})
