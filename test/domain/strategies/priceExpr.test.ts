import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { MarketContextError } from '@/domain/strategies/marketContext'
import {
  assertPriceExpr,
  evaluatePriceExpr,
  formatPriceExpr,
  InvalidPriceExprError,
  series,
  times,
} from '@/domain/strategies/priceExpr'
import { candle } from '../../support/candles'
import { bin } from '../../support/priceExpr'
import { contextWith } from '../../support/marketContext'

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

describe('PriceExpr', () => {
  describe('builders', () => {
    it('series construye una hoja con el alias', () => {
      expect(series('sma_fast')).toEqual({ kind: 'series', id: 'sma_fast' })
    })

    it('times construye el árbol en orden', () => {
      const expr = times(series('entry'), times(series('two'), series('atr14')))

      expect(expr).toEqual({
        kind: 'binary',
        op: '*',
        left: { kind: 'series', id: 'entry' },
        right: {
          kind: 'binary',
          op: '*',
          left: { kind: 'series', id: 'two' },
          right: { kind: 'series', id: 'atr14' },
        },
      })
      expect(times('a', 'b')).toEqual({
        kind: 'binary',
        op: '*',
        left: { kind: 'series', id: 'a' },
        right: { kind: 'series', id: 'b' },
      })
    })

    it('alias vacío en un builder → InvalidPriceExprError', () => {
      expect(() => series('')).toThrow(InvalidPriceExprError)
    })
  })

  describe('assertPriceExpr', () => {
    it('expresión válida con cualquier operador aritmético → la devuelve sin lanzar', () => {
      for (const op of ['+', '-', '*', '/'] as const) {
        const expr = bin(op, series('fast'), series('slow'))
        expect(assertPriceExpr(expr)).toBe(expr)
      }
    })

    it('número (precio constante) → InvalidPriceExprError con name', () => {
      try {
        assertPriceExpr(42)
        throw new Error('debía lanzar InvalidPriceExprError')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPriceExprError)
        expect((error as Error).name).toBe('InvalidPriceExprError')
        expect((error as Error).message).toContain('Expresión de precio inválida')
        expect((error as Error).message).toContain(
          'se esperaba una hoja o una operación aritmética',
        )
      }
    })

    it('hoja con id no string o vacío → error', () => {
      expect(() => assertPriceExpr({ kind: 'series', id: 7 })).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr({ kind: 'series', id: '' })).toThrow(InvalidPriceExprError)
      expect(() => assertPriceExpr({ kind: 'series', id: '' })).toThrow(
        'la serie requiere un alias no vacío',
      )
      expect(() => assertPriceExpr({ kind: 'series' })).toThrow(InvalidPriceExprError)
    })

    it('binary con op desconocido → error', () => {
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '%', left: series('a'), right: series('b') }),
      ).toThrow(InvalidPriceExprError)
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '%', left: series('a'), right: series('b') }),
      ).toThrow('operador desconocido: se admite +, -, * o / entre series')
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '%', left: series('a'), right: series('b') }),
      ).toThrow('(recibido: "binary %")')
    })

    it('kind desconocido con op válido → sigue rechazando (no entra por binary)', () => {
      expect(() =>
        assertPriceExpr({ kind: 'weird', op: '+', left: series('a'), right: series('b') }),
      ).toThrow('operador desconocido: se admite +, -, * o / entre series')
    })

    it('binary con un hijo inválido → el hijo también se valida', () => {
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '+', left: 5, right: series('b') }),
      ).toThrow(InvalidPriceExprError)
      expect(() =>
        assertPriceExpr({ kind: 'binary', op: '+', left: series('a'), right: 5 }),
      ).toThrow(InvalidPriceExprError)
    })

    it('assertPriceExpr rechaza un hijo inválido en cualquier profundidad', () => {
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
    const context = contextWith(CANDLES, {
      fast: [1, 2, 3, 4],
      slow: [10, 20, 30, 40],
      two: [2, 2, 2, 2],
      warmup: [1, 2, null, null],
      zero: [0, 0, 0, 0],
      huge: [1e300, 1e300, 1e300, 1e300],
      nan: [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
    })

    it('hoja → valor del indicador en la vela actual', () => {
      expect(evaluatePriceExpr(series('fast'), context)).toBe(4)
      expect(evaluatePriceExpr(series('slow'), context)).toBe(40)
    })

    it('aritmética de primer nivel: +, -, *, /', () => {
      expect(evaluatePriceExpr(bin('+', 'fast', 'slow'), context)).toBe(44)
      expect(evaluatePriceExpr(bin('-', 'slow', 'fast'), context)).toBe(36)
      expect(evaluatePriceExpr(times('fast', 'two'), context)).toBe(8)
      expect(evaluatePriceExpr(bin('/', 'slow', 'fast'), context)).toBe(10)
    })

    it('expresión anidada respeta la precedencia del árbol', () => {
      // slow - (fast * two) = 40 - 8 = 32
      const expr = bin('-', 'slow', times('fast', 'two'))

      expect(evaluatePriceExpr(expr, context)).toBe(32)
    })

    it('serie en calentamiento (null) → null', () => {
      expect(evaluatePriceExpr(series('warmup'), context)).toBeNull()
      expect(evaluatePriceExpr(bin('+', 'warmup', 'fast'), context)).toBeNull()
    })

    it('alias no registrado → propaga MarketContextError', () => {
      expect(() => evaluatePriceExpr(series('missing'), context)).toThrow(MarketContextError)
      expect(() => evaluatePriceExpr(bin('+', 'missing', 'fast'), context)).toThrow(
        MarketContextError,
      )
    })

    it('división por cero (0 o -0) → null: nunca devuelve no finito', () => {
      expect(evaluatePriceExpr(bin('/', 'fast', 'zero'), context)).toBeNull()
      expect(evaluatePriceExpr(bin('/', 'fast', times('zero', 'two')), context)).toBeNull()
    })

    it('resultados no finitos (Infinity por desbordamiento o NaN) → null', () => {
      expect(evaluatePriceExpr(bin('*', 'huge', 'huge'), context)).toBeNull() // 1e600
      expect(evaluatePriceExpr(bin('+', 'nan', 'fast'), context)).toBeNull()
      expect(evaluatePriceExpr(bin('-', 'nan', 'nan'), context)).toBeNull()
    })

    it('0/0 → null (NaN cubierto)', () => {
      const allZero = contextWith(CANDLES, { a: [0, 0, 0, 0], b: [0, 0, 0, 0] })

      expect(evaluatePriceExpr(bin('/', 'a', 'b'), allZero)).toBeNull()
    })

    it('resultado negativo intermedio es válido (la validación de precio no es aquí)', () => {
      const context2 = contextWith(CANDLES, { a: [1, 1, 1, 1], b: [10, 10, 10, 10] })

      expect(evaluatePriceExpr(bin('-', 'a', 'b'), context2)).toBe(-9)
    })
  })

  describe('formatPriceExpr', () => {
    it('serie → su alias', () => {
      expect(formatPriceExpr(series('sma_fast'))).toBe('sma_fast')
    })

    it('operaciones binarias con anidación entre paréntesis', () => {
      expect(formatPriceExpr(bin('+', 'fast', 'slow'))).toBe('fast + slow')
      expect(formatPriceExpr(times('two', 'atr'))).toBe('two * atr')
      // (entry - (two * atr))  →  prioridad visual sin ambigüedad
      expect(formatPriceExpr(bin('-', 'entry', times('two', 'atr')))).toBe('entry - (two * atr)')
      expect(formatPriceExpr(bin('/', bin('+', 'a', 'b'), 'c'))).toBe('(a + b) / c')
    })
  })
})
