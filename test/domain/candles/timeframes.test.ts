import { describe, expect, it } from 'vitest'
import {
  MAX_CANDLES,
  SUPPORTED_TIMEFRAMES,
  candleLimitForRange,
  isSupportedTimeframe,
  resolveTimeframe,
  timeframeToMs,
  type Timeframe,
} from '@/domain/candles/timeframes'

describe('timeframes soportados', () => {
  it('incluye los timeframes del backlog', () => {
    for (const tf of ['1m', '5m', '15m', '1h', '4h', '1d'] as const) {
      expect(SUPPORTED_TIMEFRAMES).toContain(tf)
      expect(isSupportedTimeframe(tf)).toBe(true)
    }
  })

  it('rechaza timeframes desconocidos', () => {
    expect(isSupportedTimeframe('2h')).toBe(false)
    expect(isSupportedTimeframe('')).toBe(false)
    expect(isSupportedTimeframe('1M')).toBe(false) // mayúscula distinguida
    expect(isSupportedTimeframe(42)).toBe(false)
  })

  it('resolveTimeframe devuelve el timeframe o lanza', () => {
    expect(resolveTimeframe('15m')).toBe('15m')
    expect(() => resolveTimeframe('7m')).toThrow(/timeframe/i)
  })
})

describe('timeframeToMs', () => {
  const expected: Record<Timeframe, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
  }

  it('convierte cada timeframe a milisegundos', () => {
    for (const [tf, ms] of Object.entries(expected)) {
      expect(timeframeToMs(tf as Timeframe)).toBe(ms)
    }
  })

  it('lanza ante timeframe no soportado', () => {
    expect(() => timeframeToMs('2h' as Timeframe)).toThrow()
  })
})

describe('candleLimitForRange', () => {
  const ONE_HOUR = 3_600_000

  it('calcula cuántas velas hay en el rango (extremos inclusivos)', () => {
    // 00:00 → 04:00 en 1h = 5 velas (00,01,02,03,04)
    expect(candleLimitForRange(0, 4 * ONE_HOUR, '1h')).toBe(5)
  })

  it('limita el resultado a MAX_CANDLES', () => {
    const tenYears = 10 * 365 * 24 * ONE_HOUR
    expect(candleLimitForRange(0, tenYears, '1h')).toBe(MAX_CANDLES)
  })

  it('rechaza fechas invertidas (start >= end)', () => {
    expect(() => candleLimitForRange(1000, 1000, '1h')).toThrow()
    expect(() => candleLimitForRange(2000, 1000, '1h')).toThrow()
  })
})
