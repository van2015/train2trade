import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Indicator } from '@/domain/indicators/indicator'
import { Ema } from '@/domain/indicators/ema'
import { Rsi } from '@/domain/indicators/rsi'
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

describe('contrato Indicator', () => {
  it.each([
    ['Sma(3)', new Sma(3), 'sma'],
    ['Ema(3)', new Ema(3), 'ema'],
    ['Rsi(3)', new Rsi(3), 'rsi'],
  ] as const)('%s: salida alineada con la entrada y name estable', (_label, indicator, name) => {
    const candles = candlesFrom([5, 3, 8, 1, 9, 4, 7])
    const result: Indicator = indicator
    const values = result.calculate(candles)

    expect(result.name).toBe(name)
    expect(values).toHaveLength(candles.length)
    expect(values.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
    expect(values.every((entry) => entry.value === null || typeof entry.value === 'number')).toBe(
      true,
    )
  })

  it.each([
    ['Sma(3)', new Sma(3)],
    ['Ema(3)', new Ema(3)],
    ['Rsi(3)', new Rsi(3)],
  ] as const)('%s: la entrada vacía produce []', (_label, indicator) => {
    expect(indicator.calculate([])).toEqual([])
  })
})
