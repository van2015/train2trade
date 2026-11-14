import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

/** Serie alineada con CANDLES: primer valor en calentamiento (null). */
const FAST: IndicatorValue[] = [
  { time: 1000, value: null },
  { time: 2000, value: 1.5 },
  { time: 3000, value: 2.5 },
  { time: 4000, value: 3.5 },
]

describe('MarketContext', () => {
  describe('construcción e invariantes', () => {
    it('velas vacías → error de contexto con name MarketContextError', () => {
      try {
        MarketContext.from({ candles: [] })
        throw new Error('debía lanzar MarketContextError')
      } catch (error) {
        expect(error).toBeInstanceOf(MarketContextError)
        expect((error as Error).name).toBe('MarketContextError')
      }
    })

    it('velas fuera de orden → error de contexto', () => {
      expect(() => MarketContext.from({ candles: [candle(3000, 1), candle(1000, 2)] })).toThrow(
        MarketContextError,
      )
    })

    it('velas con time duplicado → error de contexto', () => {
      expect(() => MarketContext.from({ candles: [candle(1000, 1), candle(1000, 2)] })).toThrow(
        MarketContextError,
      )
    })

    it('serie con longitud distinta de las velas → error de contexto', () => {
      expect(() =>
        MarketContext.from({ candles: CANDLES.slice(0, 2), indicators: { fast: FAST } }),
      ).toThrow(MarketContextError)
    })

    it('serie con time desalineado respecto de las velas → error de contexto', () => {
      const misaligned: IndicatorValue[] = FAST.map((entry, index) =>
        index === 1 ? { time: 9999, value: entry.value } : entry,
      )

      expect(() =>
        MarketContext.from({ candles: CANDLES, indicators: { fast: misaligned } }),
      ).toThrow(MarketContextError)
    })

    it('lo que expone el contexto es inmutable: intentar mutarlo lanza', () => {
      const context = MarketContext.from({ candles: CANDLES })
      const mutable = context.candles as Candle[]

      expect(() => mutable.push(candle(5000, 14))).toThrow(TypeError)
      expect(context.length).toBe(4)
    })
  })

  describe('ventana temporal (sin look-ahead)', () => {
    it('construido con las primeras N velas, length es N y current es la N-ésima', () => {
      const context = MarketContext.from({ candles: CANDLES.slice(0, 2) })

      expect(context.length).toBe(2)
      expect(context.current).toEqual(CANDLES[1])
      expect(context.time).toBe(2000)
    })

    it('la vela siguiente a la actual no está presente ni es alcanzable', () => {
      const context = MarketContext.from({ candles: CANDLES.slice(0, 3) })

      expect(context.current.time).toBe(3000)
      expect(context.candles.some((entry) => entry.time === 4000)).toBe(false)
      expect(context.candles[3]).toBeUndefined()
    })

    it('current es la última visible, previous la penúltima, time su timestamp y length el total', () => {
      const context = MarketContext.from({ candles: CANDLES, indicators: { fast: FAST } })

      expect(context.current).toEqual(CANDLES[3])
      expect(context.previous).toEqual(CANDLES[2])
      expect(context.time).toBe(4000)
      expect(context.length).toBe(4)
      expect(context.candles).toEqual(CANDLES)
    })

    it('con una sola vela previous no existe', () => {
      const context = MarketContext.from({ candles: [candle(1000, 10)] })

      expect(context.current).toEqual(candle(1000, 10))
      expect(context.previous).toBeUndefined()
      expect(context.length).toBe(1)
    })
  })

  describe('series builtin de la vela actual', () => {
    const context = MarketContext.from({ candles: CANDLES })

    it('close/open/high/low se resuelven desde la vela actual', () => {
      expect(context.value('close')).toBe(13)
      expect(context.value('open')).toBe(13)
      expect(context.value('high')).toBe(14)
      expect(context.value('low')).toBe(12)
    })

    it('con back resuelven la vela anterior', () => {
      expect(context.value('close', 1)).toBe(12)
      expect(context.value('high', 1)).toBe(13)
    })

    it('back más allá del inicio → null (como las series de indicadores)', () => {
      expect(context.value('close', 4)).toBeNull()
    })

    it('el alias registrado tiene prioridad sobre la builtin', () => {
      const withClose = MarketContext.from({ candles: CANDLES, indicators: { close: FAST } })

      expect(withClose.value('close')).toBe(3.5)
      expect(withClose.value('close', 3)).toBeNull()
    })

    it('alias no registrado ni builtin → MarketContextError', () => {
      expect(() => context.value('volume')).toThrow(MarketContextError)
    })

    it('back negativo en builtin → RangeError', () => {
      expect(() => context.value('close', -1)).toThrow(RangeError)
    })
  })

  describe('niveles de operación (entry/sl/tp)', () => {
    it('resuelve entry/sl/tp desde levels; ausentes → null', () => {
      const context = MarketContext.from({
        candles: CANDLES,
        levels: { entry: 100, sl: 95, tp: 110 },
      })

      expect(context.value('entry')).toBe(100)
      expect(context.value('sl')).toBe(95)
      expect(context.value('tp')).toBe(110)

      const empty = MarketContext.from({ candles: CANDLES })
      expect(empty.value('entry')).toBeNull()
      expect(empty.value('sl')).toBeNull()
      expect(empty.value('tp')).toBeNull()
    })

    it('levels explícitos null → null (sin posición / desactivado)', () => {
      const context = MarketContext.from({ candles: CANDLES, levels: { entry: null, sl: null } })

      expect(context.value('entry')).toBeNull()
      expect(context.value('sl')).toBeNull()
    })

    it('alias de operación con back > 0 → null (no tienen histórico)', () => {
      const context = MarketContext.from({ candles: CANDLES, levels: { entry: 100 } })

      expect(context.value('entry', 1)).toBeNull()
      expect(context.value('entry', 3)).toBeNull()
    })

    it('levels con tipos inválidos (string, NaN) → MarketContextError', () => {
      expect(() =>
        MarketContext.from({ candles: CANDLES, levels: { entry: '100' as unknown as number } }),
      ).toThrow(MarketContextError)
      expect(() => MarketContext.from({ candles: CANDLES, levels: { sl: Number.NaN } })).toThrow(
        MarketContextError,
      )
      expect(() =>
        MarketContext.from({ candles: CANDLES, levels: { tp: Number.POSITIVE_INFINITY } }),
      ).toThrow(MarketContextError)
    })

    it('el alias de indicador registrado tiene prioridad sobre el de operación', () => {
      const context = MarketContext.from({
        candles: CANDLES,
        indicators: { entry: FAST },
        levels: { entry: 999 },
      })

      expect(context.value('entry')).toBe(3.5)
    })

    it('withLevels fusiona niveles y comparte velas/series (contexto inmutable)', () => {
      const base = MarketContext.from({
        candles: CANDLES,
        indicators: { fast: FAST },
        levels: { entry: 100, sl: null },
      })
      const derived = base.withLevels({ sl: 95, tp: 110 })

      expect(derived.value('entry')).toBe(100) // fusionado
      expect(derived.value('sl')).toBe(95)
      expect(derived.value('tp')).toBe(110)
      expect(base.value('sl')).toBeNull() // el original no cambia
      expect(derived.candles).toBe(base.candles) // comparte ventana
      expect(derived.value('fast')).toBe(3.5) // comparte series
      expect(Object.isFrozen(derived.levels)).toBe(true)
    })

    it('withLevels con niveles inválidos → MarketContextError', () => {
      const base = MarketContext.from({ candles: CANDLES })

      expect(() => base.withLevels({ sl: 'x' as unknown as number })).toThrow(MarketContextError)
    })
  })

  describe('acceso a series', () => {
    const context = MarketContext.from({ candles: CANDLES, indicators: { fast: FAST } })

    it('back 0 es el valor en la vela actual y back 1 en la anterior', () => {
      expect(context.value('fast')).toBe(3.5)
      expect(context.value('fast', 1)).toBe(2.5)
    })

    it('en calentamiento (la serie aún no tiene dato) → null', () => {
      expect(context.value('fast', 3)).toBeNull()
    })

    it('back que pide ir más allá del inicio → null', () => {
      expect(context.value('fast', 4)).toBeNull()
      expect(context.value('fast', 99)).toBeNull()
    })

    it('alias no registrado → error de contexto (error de configuración)', () => {
      expect(() => context.value('slow')).toThrow(MarketContextError)
    })

    it('back negativo o no entero → RangeError', () => {
      expect(() => context.value('fast', -1)).toThrow(RangeError)
      expect(() => context.value('fast', 1.5)).toThrow(RangeError)
    })
  })
})
