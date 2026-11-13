import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'
import {
  assertPriceExpr,
  dividedBy,
  evaluatePriceExpr,
  InvalidPriceExprError,
  minus,
  plus,
  PriceExpr,
  series,
  times,
} from '@/domain/strategies/priceExpr'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

/** Contexto con las series indicadas (null donde no hay valor). */
function contextWith(indicators: Record<string, (number | null)[]>): MarketContext {
  const seriesById: Record<string, IndicatorValue[]> = {}
  for (const [id, values] of Object.entries(indicators)) {
    seriesById[id] = CANDLES.map((entry, index) => ({
      time: entry.time,
      value: values[index] ?? null,
    }))
  }
  return MarketContext.from({ candles: CANDLES, indicators: seriesById })
}

describe('PriceExpr', () => {
  describe('builders', () => {
    it('series construye una hoja con el alias', () => {
      expect(series('sma_fast')).toEqual({ kind: 'series', id: 'sma_fast' })
    })

    it('plus/minus/times/dividedBy construyen el árbol en orden', () => {
      const expr = minus(series('entry'), times(series('two'), series('atr14')))

      expect(expr).toEqual({
        kind: 'binary',
        op: '-',
        left: { kind: 'series', id: 'entry' },
        right: {
          kind: 'binary',
          op: '*',
          left: { kind: 'series', id: 'two' },
          right: { kind: 'series', id: 'atr14' },
        },
      })
      expect(plus('a', 'b')).toEqual({
        kind: 'binary',
        op: '+',
        left: { kind: 'series', id: 'a' },
        right: { kind: 'series', id: 'b' },
      })
      expect(times('a', 'b')).toEqual({
        kind: 'binary',
        op: '*',
        left: { kind: 'series', id: 'a' },
        right: { kind: 'series', id: 'b' },
      })
      expect(dividedBy('a', 'b')).toEqual({
        kind: 'binary',
        op: '/',
        left: { kind: 'series', id: 'a' },
        right: { kind: 'series', id: 'b' },
      })
    })

    it('alias vacío en un builder → InvalidPriceExprError', () => {
      expect(() => series('')).toThrow(InvalidPriceExprError)
      expect(() => plus('', 'b')).toThrow(InvalidPriceExprError)
    })
  })

  describe('assertPriceExpr', () => {
    it('expresión válida → la devuelve sin lanzar', () => {
      const expr = plus(series('fast'), series('slow'))
      expect(assertPriceExpr(expr)).toBe(expr)
    })

    it('número (precio constante) → InvalidPriceExprError con name', () => {
      try {
        assertPriceExpr(42)
        throw new Error('debía lanzar InvalidPriceExprError')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPriceExprError)
        expect((error as Error).name).toBe('InvalidPriceExprError')
      }
    })

    it('hoja con id no string o vacío → error', () => {
      expect(() => assertPriceExpr({ kind: 'series', id: 7 })).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr({ kind: 'series', id: '' })).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr({ kind: 'series' })).toThrow(InvalidPriceExprError)
    })

    it('binary con op desconocido → error', () => {
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '%', left: series('a'), right: series('b') }),
      ).toThrow(InvalidPriceExprError)
    })

    it('hijo inválido en cualquier profundidad → error', () => {
      const malformed = {
        kind: 'binary',
        op: '+',
        left: series('a'),
        right: { kind: 'binary', op: '+', left: series('b'), right: 5 },
      }

      expect(() => assertPriceExpr(malformed)).toThrow(InvalidPriceExprError)
    })

    it('null, undefined, string y array → error', () => {
      expect(() => assertPriceExpr(null)).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr(undefined)).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr('fast')).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr([])).toThrow(InvalidPriceExprError)
    })
  })

  describe('evaluatePriceExpr', () => {
    const context = contextWith({
      fast: [1, 2, 3, 4],
      slow: [10, 20, 30, 40],
      two: [2, 2, 2, 2],
      warmup: [1, 2, null, null],
      zero: [0, 0, 0, 0],
    })

    it('hoja → valor del indicador en la vela actual', () => {
      expect(evaluatePriceExpr(series('fast'), context)).toBe(4)
      expect(evaluatePriceExpr(series('slow'), context)).toBe(40)
    })

    it('aritmética de primer nivel: +, -, *, /', () => {
      expect(evaluatePriceExpr(plus('fast', 'slow'), context)).toBe(44)
      expect(evaluatePriceExpr(minus('slow', 'fast'), context)).toBe(36)
      expect(evaluatePriceExpr(times('fast', 'two'), context)).toBe(8)
      expect(evaluatePriceExpr(dividedBy('slow', 'fast'), context)).toBe(10)
    })

    it('expresión anidada respeta la precedencia del árbol', () => {
      // slow - (fast * two) = 40 - 8 = 32
      const expr = minus('slow', times('fast', 'two'))

      expect(evaluatePriceExpr(expr, context)).toBe(32)
    })

    it('serie en calentamiento (null) → null', () => {
      expect(evaluatePriceExpr(series('warmup'), context)).toBeNull()
      expect(evaluatePriceExpr(plus('warmup', 'fast'), context)).toBeNull()
    })

    it('alias no registrado → propaga MarketContextError', () => {
      expect(() => evaluatePriceExpr(series('missing'), context)).toThrow(MarketContextError)
      expect(() => evaluatePriceExpr(plus('missing', 'fast'), context)).toThrow(MarketContextError)
    })

    it('división por cero (0 o -0) → null: nunca devuelve no finito', () => {
      expect(evaluatePriceExpr(dividedBy('fast', 'zero'), context)).toBeNull()
      expect(evaluatePriceExpr(dividedBy('fast', times('zero', 'two')), context)).toBeNull()
    })

    it('0/0 → null (NaN cubierto)', () => {
      const allZero = contextWith({ a: [0, 0, 0, 0], b: [0, 0, 0, 0] })

      expect(evaluatePriceExpr(dividedBy('a', 'b'), allZero)).toBeNull()
    })

    it('resultado negativo intermedio es válido (la validación de precio no es aquí)', () => {
      const context2 = contextWith({ a: [1, 1, 1, 1], b: [10, 10, 10, 10] })

      expect(evaluatePriceExpr(minus('a', 'b'), context2)).toBe(-9)
    })
  })
})
