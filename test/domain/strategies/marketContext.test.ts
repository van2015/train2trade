import { beforeEach, describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

const FAST: IndicatorValue[] = [
  { time: 1000, value: null },
  { time: 2000, value: 1.5 },
  { time: 3000, value: 2.5 },
  { time: 4000, value: 3.5 },
]

describe('MarketContext', () => {
  describe('invariantes en from', () => {
    it('velas vacías → MarketContextError', () => {
      expect(() => MarketContext.from({ candles: [] })).toThrow(MarketContextError)
    })

    it('velas fuera de orden → MarketContextError', () => {
      expect(() => MarketContext.from({ candles: [candle(3000, 1), candle(1000, 2)] })).toThrow(
        MarketContextError,
      )
    })

    it('velas con time duplicado → MarketContextError', () => {
      expect(() => MarketContext.from({ candles: [candle(1000, 1), candle(1000, 2)] })).toThrow(
        MarketContextError,
      )
    })

    it('serie con longitud distinta de candles → MarketContextError', () => {
      expect(() =>
        MarketContext.from({ candles: CANDLES.slice(0, 2), indicators: { fast: FAST } }),
      ).toThrow(MarketContextError)
    })

    it('serie con time desalineado respecto a las velas → MarketContextError', () => {
      const misaligned: IndicatorValue[] = FAST.map((entry, index) =>
        index === 0 ? { time: 9999, value: entry.value } : entry,
      )

      expect(() =>
        MarketContext.from({ candles: CANDLES, indicators: { fast: misaligned } }),
      ).toThrow(MarketContextError)
    })

    it('el error tiene name MarketContextError', () => {
      try {
        MarketContext.from({ candles: [] })
        throw new Error('debía lanzar MarketContextError')
      } catch (error) {
        expect(error).toBeInstanceOf(MarketContextError)
        expect((error as Error).name).toBe('MarketContextError')
      }
    })

    it('from es idempotente sobre una instancia', () => {
      const context = MarketContext.from({ candles: CANDLES, indicators: { fast: FAST } })

      expect(MarketContext.from(context)).toBe(context)
    })
  })

  describe('acceso a las velas', () => {
    let context: MarketContext

    beforeEach(() => {
      context = MarketContext.from({ candles: CANDLES, indicators: { fast: FAST } })
    })

    it('current es la última vela, previous la penúltima, time su timestamp y length el total', () => {
      expect(context.current).toEqual(CANDLES[3])
      expect(context.previous).toEqual(CANDLES[2])
      expect(context.time).toBe(4000)
      expect(context.length).toBe(4)
      expect(context.candles).toEqual(CANDLES)
    })

    it('con una sola vela previous es undefined', () => {
      const single = MarketContext.from({ candles: [candle(1000, 10)] })

      expect(single.current).toEqual(candle(1000, 10))
      expect(single.previous).toBeUndefined()
      expect(single.length).toBe(1)
    })
  })

  describe('value', () => {
    let context: MarketContext

    beforeEach(() => {
      context = MarketContext.from({ candles: CANDLES, indicators: { fast: FAST } })
    })

    it('back 0 es el valor en la vela actual y back 1 en la anterior', () => {
      expect(context.value('fast')).toBe(3.5)
      expect(context.value('fast', 1)).toBe(2.5)
      expect(context.value('fast', 3)).toBe(null)
    })

    it('devuelve null durante el calentamiento de la serie', () => {
      expect(context.value('fast', 3)).toBeNull()
    })

    it('devuelve null cuando back exige ir más allá del inicio de la serie', () => {
      expect(context.value('fast', 4)).toBeNull()
      expect(context.value('fast', 99)).toBeNull()
    })

    it('alias no registrado → MarketContextError', () => {
      expect(() => context.value('slow')).toThrow(MarketContextError)
    })

    it('back negativo o no entero → RangeError', () => {
      expect(() => context.value('fast', -1)).toThrow(RangeError)
      expect(() => context.value('fast', 1.5)).toThrow(RangeError)
    })
  })

  describe('inmutabilidad', () => {
    it('candles está congelado: intentar mutar lanza', () => {
      const context = MarketContext.from({ candles: CANDLES })
      const mutable = context.candles as Candle[]

      expect(() => mutable.push(candle(5000, 14))).toThrow(TypeError)
    })
  })
})
