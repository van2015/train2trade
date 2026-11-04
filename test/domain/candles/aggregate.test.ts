import { describe, expect, it } from 'vitest'
import { aggregateCandles } from '@/domain/candles/aggregate'
import type { Candle } from '@/domain/candles/types'

const MIN = 60_000

function candle(time: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: v }
}

describe('aggregateCandles', () => {
  it('agrega velas de 1m en velas de 5m', () => {
    // bucket 0..299999 (5 minutos) → 5 velas de 1m
    const input = [
      candle(0, 10, 12, 9, 11, 1),
      candle(MIN, 11, 15, 10, 14, 2),
      candle(2 * MIN, 14, 16, 13, 15, 3),
      candle(3 * MIN, 15, 15, 8, 9, 4),
      candle(4 * MIN, 9, 10, 9, 10, 5),
    ]

    const [agg] = aggregateCandles(input, 5 * MIN)

    expect(agg).toEqual({
      time: 0, // apertura del bucket
      open: 10, // primera vela
      high: 16, // máximo
      low: 8, // mínimo
      close: 10, // última vela
      volume: 15, // suma
    })
  })

  it('genera un bucket por cada rango temporal con velas', () => {
    const input = [
      candle(0, 1, 1, 1, 1),
      candle(4 * MIN, 2, 2, 2, 2), // mismo bucket de 5m
      candle(5 * MIN, 3, 3, 3, 3), // bucket siguiente
    ]

    const result = aggregateCandles(input, 5 * MIN)

    expect(result).toHaveLength(2)
    expect(result.map((c) => c.time)).toEqual([0, 5 * MIN])
    expect(result[1]).toEqual({ time: 5 * MIN, open: 3, high: 3, low: 3, close: 3, volume: 1 })
  })

  it('funciona aunque el input venga desordenado', () => {
    const input = [
      candle(MIN, 11, 15, 10, 14, 2),
      candle(0, 10, 12, 9, 11, 1),
      candle(2 * MIN, 14, 16, 13, 15, 3),
    ]

    const [agg] = aggregateCandles(input, 5 * MIN)

    expect(agg).toEqual({ time: 0, open: 10, high: 16, low: 9, close: 15, volume: 6 })
  })

  it('devuelve [] para input vacío', () => {
    expect(aggregateCandles([], 5 * MIN)).toEqual([])
  })

  it('una sola vela por bucket pasa casi intacta', () => {
    const input = [candle(10 * MIN, 5, 6, 4, 5.5, 7)]

    expect(aggregateCandles(input, 5 * MIN)).toEqual([
      { time: 10 * MIN, open: 5, high: 6, low: 4, close: 5.5, volume: 7 },
    ])
  })
})
