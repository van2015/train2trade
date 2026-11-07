import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { InvalidPeriodError } from '@/domain/indicators/indicator'
import { Ema } from '@/domain/indicators/ema'

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
  return new Ema(period).calculate(candlesFrom(closes)).map((entry) => entry.value)
}

describe('Ema', () => {
  it('siembra con la SMA de los primeros period cierres y aplica k = 2/(period+1)', () => {
    // period 3 → k = 0.5: semilla = media(2,4,6) = 4; luego 8*.5+4*.5=6, 10*.5+6*.5=8, 12*.5+8*.5=10
    expect(values(3, [2, 4, 6, 8, 10, 12])).toEqual([null, null, 4, 6, 8, 10])
  })

  it('produce null exactamente en los primeros period - 1 índices y alinea time', () => {
    const candles = candlesFrom([5, 4, 3, 2, 1])
    const result = new Ema(3).calculate(candles)

    expect(result.slice(0, 2).every((entry) => entry.value === null)).toBe(true)
    expect(result.slice(2).every((entry) => typeof entry.value === 'number')).toBe(true)
    expect(result).toHaveLength(candles.length)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })

  it('la entrada vacía produce []', () => {
    expect(new Ema(3).calculate([])).toEqual([])
  })

  it('Ema(1) es idéntica a la serie de cierres (k = 1)', () => {
    expect(values(1, [3, 1, 4])).toEqual([3, 1, 4])
  })

  it('lanza InvalidPeriodError con periodos inválidos', () => {
    for (const period of [0, -1, 2.5, NaN]) {
      expect(() => new Ema(period)).toThrow(InvalidPeriodError)
    }
  })

  it('el error tiene name InvalidPeriodError', () => {
    try {
      new Ema(-1)
      throw new Error('debía lanzar InvalidPeriodError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPeriodError)
      expect((error as Error).name).toBe('InvalidPeriodError')
    }
  })
})
