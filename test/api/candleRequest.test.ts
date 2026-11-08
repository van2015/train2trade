import { describe, expect, it } from 'vitest'
import { MAX_CANDLES, candleLimitForRange } from '@/api/candleRequest'
import { Timeframe } from '@/domain/candles/timeframe'

describe('candleLimitForRange', () => {
  it('calcula cuántas velas hay en el rango (extremos inclusivos)', () => {
    // 00:00 → 04:00 en 1h = 5 velas (00,01,02,03,04)
    expect(candleLimitForRange(0, 4 * Timeframe.HOUR.ms, Timeframe.HOUR)).toBe(5)
  })

  it('limita el resultado a MAX_CANDLES', () => {
    const tenYears = 10 * 365 * 24 * Timeframe.HOUR.ms
    expect(candleLimitForRange(0, tenYears, Timeframe.HOUR)).toBe(MAX_CANDLES)
  })

  it('rechaza fechas invertidas (start >= end)', () => {
    expect(() => candleLimitForRange(1000, 1000, Timeframe.HOUR)).toThrow()
    expect(() => candleLimitForRange(2000, 1000, Timeframe.HOUR)).toThrow()
  })
})

describe('MAX_CANDLES', () => {
  it('es el límite de velas por petición a la API', () => {
    expect(MAX_CANDLES).toBe(1000)
  })
})
