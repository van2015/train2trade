import { describe, expect, it } from 'vitest'
import { Indicator, InvalidPeriodError } from '@/domain/indicators/indicator'
import { Ema } from '@/domain/indicators/ema'
import { LowestLow } from '@/domain/indicators/lowestLow'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'
import { candlesFrom } from '../../support/candles'

/**
 * [label, clase, name canónico, primer índice con valor]. El calentamiento
 * difiere: SMA/EMA/LowestLow necesitan `period - 1` velas y RSI `period` cambios.
 */
const INDICATORS: Array<[string, new (period: number) => Indicator, string, number]> = [
  ['Sma', Sma, 'sma', 2],
  ['Ema', Ema, 'ema', 2],
  ['Rsi', Rsi, 'rsi', 3],
  ['LowestLow', LowestLow, 'lowestLow', 2],
]

describe.each(INDICATORS)('contrato Indicator — %s', (_label, Cls, name, firstValueAt) => {
  it('name canónico y salida alineada con la entrada (longitud, time y valores tipados)', () => {
    const indicator = new Cls(3)
    const candles = candlesFrom([5, 3, 8, 1, 9, 4, 7])
    const values = indicator.calculate(candles)

    expect(indicator.name).toBe(name)
    expect(values).toHaveLength(candles.length)
    expect(values.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
    expect(values.every((entry) => entry.value === null || typeof entry.value === 'number')).toBe(
      true,
    )
  })

  it('la entrada vacía produce []', () => {
    expect(new Cls(3).calculate([])).toEqual([])
  })

  it('produce null durante todo el calentamiento y números después', () => {
    const values = new Cls(3)
      .calculate(candlesFrom([5, 4, 3, 2, 1, 0, 10]))
      .map((entry) => entry.value)

    expect(values.slice(0, firstValueAt)).toEqual(Array.from({ length: firstValueAt }, () => null))
    expect(values.slice(firstValueAt).every((value) => typeof value === 'number')).toBe(true)
  })

  it('lanza InvalidPeriodError con periodos inválidos', () => {
    for (const period of [0, -1, 2.5, NaN]) {
      expect(() => new Cls(period)).toThrow(InvalidPeriodError)
    }
  })

  it('el error tiene name InvalidPeriodError', () => {
    try {
      new Cls(0)
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

    const result = new Cls(1).calculate(shuffled)

    expect(shuffled).toEqual(snapshot)
    expect(result.map((entry) => entry.time)).toEqual(candles.map((candle) => candle.time))
  })
})
