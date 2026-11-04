import { describe, expect, it } from 'vitest'
import { normalizeCandles } from '@/domain/candles/normalize'

describe('normalizeCandles', () => {
  it('convierte OHLC de la API (strings) a números', () => {
    const raw = [
      {
        time: 1_700_000_000_000,
        open: '100.5',
        high: '110',
        low: '95.2',
        close: '108.75',
        volume: '12.4',
      },
    ]

    const result = normalizeCandles(raw)

    expect(result).toEqual([
      {
        time: 1_700_000_000_000,
        open: 100.5,
        high: 110,
        low: 95.2,
        close: 108.75,
        volume: 12.4,
      },
    ])
  })

  it('ordena ascendente por tiempo aunque la API responda descendente', () => {
    const raw = [
      { time: 3000, open: 3, high: 3, low: 3, close: 3, volume: 1 },
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 2000, open: 2, high: 2, low: 2, close: 2, volume: 1 },
    ]

    expect(normalizeCandles(raw).map((c) => c.time)).toEqual([1000, 2000, 3000])
  })

  it('elimina duplicados por tiempo conservando el último', () => {
    const raw = [
      { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 1000, open: 9, high: 9, low: 9, close: 9, volume: 9 },
    ]

    expect(normalizeCandles(raw)).toEqual([
      { time: 1000, open: 9, high: 9, low: 9, close: 9, volume: 9 },
    ])
  })

  it('descarta velas con high < low', () => {
    const raw = [
      { time: 1000, open: 5, high: 4, low: 6, close: 5, volume: 1 },
      { time: 2000, open: 5, high: 6, low: 4, close: 5, volume: 1 },
    ]

    expect(normalizeCandles(raw).map((c) => c.time)).toEqual([2000])
  })

  it('descarta velas con precios no finitos o campos ausentes', () => {
    const raw = [
      { time: 1000, open: NaN, high: 5, low: 4, close: 5, volume: 1 },
      { time: 2000, open: 5, high: Infinity, low: 4, close: 5, volume: 1 },
      { time: 3000, open: 5, high: 6, low: 4, close: 5 }, // sin volume
      { time: 4000, open: 5, high: 6, low: 4, close: 5, volume: 1 },
    ]

    expect(normalizeCandles(raw).map((c) => c.time)).toEqual([4000])
  })

  it('lanza ante entrada que no es un array', () => {
    expect(() => normalizeCandles(null)).toThrow()
    expect(() => normalizeCandles({ trades: [] })).toThrow()
    expect(() => normalizeCandles('[]')).toThrow()
  })

  it('devuelve [] para array vacío', () => {
    expect(normalizeCandles([])).toEqual([])
  })
})
