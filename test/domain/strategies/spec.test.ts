import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext } from '@/domain/strategies/marketContext'
import {
  All,
  Any,
  CrossesAbove,
  CrossesBelow,
  Greater,
  Lower,
  Not,
  Rule,
} from '@/domain/strategies/rules'
import {
  assertRuleSpec,
  buildRule,
  InvalidStrategyDefinitionError,
  RuleSpec,
  SeriesClasses,
} from '@/domain/strategies/spec'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

function contextWith(indicators: Record<string, (number | null)[]>): MarketContext {
  const series: Record<string, IndicatorValue[]> = {}
  for (const [id, values] of Object.entries(indicators)) {
    series[id] = CANDLES.map((entry, index) => ({ time: entry.time, value: values[index] ?? null }))
  }
  return MarketContext.from({ candles: CANDLES, indicators: series })
}

/** Catálogo de clases para las pruebas (el real lo construye `buildStrategy`, ronda C). */
const CLASSES: SeriesClasses = {
  close: 'price',
  open: 'price',
  high: 'price',
  low: 'price',
  entry: 'price',
  sl: 'price',
  tp: 'price',
  ema12: 'price',
  sma_fast: 'price',
  sma_slow: 'price',
  rsi14: 'oscillator',
  umbral30: 'constant',
  two: 'constant',
}

describe('RuleSpec', () => {
  describe('assertRuleSpec (validación de forma)', () => {
    it('condición válida con cada operador → no lanza', () => {
      for (const op of ['crosses_above', 'crosses_below', '>', '<'] as const) {
        expect(() =>
          assertRuleSpec({ kind: 'condition', op, a: 'close', b: 'ema12' }),
        ).not.toThrow()
      }
    })

    it('árbol and/or/not anidado → no lanza', () => {
      const tree: RuleSpec = {
        kind: 'and',
        rules: [
          { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
          {
            kind: 'or',
            rules: [
              { kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' },
              {
                kind: 'not',
                rule: { kind: 'condition', op: 'crosses_below', a: 'sma_fast', b: 'sma_slow' },
              },
            ],
          },
        ],
      }

      expect(() => assertRuleSpec(tree)).not.toThrow()
    })

    it('kind desconocido, op desconocida o operandos no string → error', () => {
      expect(() => assertRuleSpec({ kind: 'xor', rules: [] })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => assertRuleSpec({ kind: 'condition', op: '==', a: 'close', b: 'ema12' })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => assertRuleSpec({ kind: 'condition', op: '>', a: 42, b: 'ema12' })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => assertRuleSpec({ kind: 'condition', op: '>', a: '', b: 'ema12' })).toThrow(
        InvalidStrategyDefinitionError,
      )
    })

    it('and/or sin hijos, not sin regla, no-objeto → error', () => {
      expect(() => assertRuleSpec({ kind: 'and', rules: [] })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => assertRuleSpec({ kind: 'or', rules: [] })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => assertRuleSpec({ kind: 'not' })).toThrow(InvalidStrategyDefinitionError)
      expect(() => assertRuleSpec('close > ema12')).toThrow(InvalidStrategyDefinitionError)
      expect(() => assertRuleSpec(null)).toThrow(InvalidStrategyDefinitionError)
    })

    it('hijo inválido en cualquier profundidad → error', () => {
      const malformed = {
        kind: 'and',
        rules: [
          { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
          { kind: 'not', rule: { kind: 'condition', op: 'nand', a: 'x', b: 'y' } },
        ],
      }

      expect(() => assertRuleSpec(malformed)).toThrow(InvalidStrategyDefinitionError)
    })
  })

  describe('buildRule (árbol → reglas de dominio)', () => {
    it('condición → CrossesAbove/CrossesBelow/Greater/Lower', () => {
      expect(
        buildRule(
          { kind: 'condition', op: 'crosses_above', a: 'sma_fast', b: 'sma_slow' },
          CLASSES,
        ),
      ).toBeInstanceOf(CrossesAbove)
      expect(
        buildRule(
          { kind: 'condition', op: 'crosses_below', a: 'sma_fast', b: 'sma_slow' },
          CLASSES,
        ),
      ).toBeInstanceOf(CrossesBelow)
      expect(
        buildRule({ kind: 'condition', op: '>', a: 'close', b: 'ema12' }, CLASSES),
      ).toBeInstanceOf(Greater)
      expect(
        buildRule({ kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' }, CLASSES),
      ).toBeInstanceOf(Lower)
    })

    it('and/or/not → All/Any/Not con el árbol montado', () => {
      const rule = buildRule(
        {
          kind: 'and',
          rules: [
            { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
            { kind: 'not', rule: { kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' } },
          ],
        },
        CLASSES,
      )

      expect(rule).toBeInstanceOf(All)
      expect(rule.name).toBe('(close > ema12 AND not(rsi14 < umbral30))')
      expect((rule as All).rules[1]).toBeInstanceOf(Not)
    })

    it('evalúa el árbol completo: (close > ema12) and (rsi14 < umbral30)', () => {
      const spec: RuleSpec = {
        kind: 'and',
        rules: [
          { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
          { kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' },
        ],
      }
      // close de la vela actual = 13; ema12 por debajo (10) y rsi14 por debajo del umbral (20 < 30)
      const context = contextWith({
        ema12: [8, 8, 8, 10],
        rsi14: [50, 50, 50, 20],
        umbral30: [30, 30, 30, 30],
      })

      expect(buildRule(spec, CLASSES).evaluate(context)).toBe(true)

      // rsi14 por encima del umbral → la segunda condición falla
      const context2 = contextWith({
        ema12: [8, 8, 8, 10],
        rsi14: [50, 50, 50, 45],
        umbral30: [30, 30, 30, 30],
      })
      expect(buildRule(spec, CLASSES).evaluate(context2)).toBe(false)
    })

    it('las series builtin son operandos válidos (close en condición)', () => {
      const rule = buildRule({ kind: 'condition', op: '>', a: 'close', b: 'ema12' }, CLASSES)
      const context = contextWith({ ema12: [8, 8, 8, 10] })

      expect(rule.evaluate(context)).toBe(true) // close actual 13 > 10
    })
  })

  describe('validación de clase por condición (decisión 12)', () => {
    it('price con oscillator → InvalidStrategyDefinitionError', () => {
      expect(() =>
        buildRule({ kind: 'condition', op: '>', a: 'close', b: 'rsi14' }, CLASSES),
      ).toThrow(InvalidStrategyDefinitionError)
      expect(() =>
        buildRule({ kind: 'condition', op: '<', a: 'ema12', b: 'rsi14' }, CLASSES),
      ).toThrow(InvalidStrategyDefinitionError)
    })

    it('misma clase a ambos lados → válida', () => {
      expect(() =>
        buildRule({ kind: 'condition', op: '>', a: 'close', b: 'ema12' }, CLASSES),
      ).not.toThrow()
      expect(() =>
        buildRule({ kind: 'condition', op: '<', a: 'rsi14', b: 'rsi14' }, CLASSES),
      ).not.toThrow()
    })

    it('constant es compatible con cualquier clase', () => {
      expect(() =>
        buildRule({ kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' }, CLASSES),
      ).not.toThrow()
      expect(() =>
        buildRule({ kind: 'condition', op: '>', a: 'close', b: 'two' }, CLASSES),
      ).not.toThrow()
    })

    it('alias desconocido → error', () => {
      expect(() =>
        buildRule({ kind: 'condition', op: '>', a: 'missing', b: 'ema12' }, CLASSES),
      ).toThrow(InvalidStrategyDefinitionError)
      expect(() =>
        buildRule({ kind: 'condition', op: '>', a: 'close', b: 'missing' }, CLASSES),
      ).toThrow(InvalidStrategyDefinitionError)
    })

    it('la validación recorre todo el árbol: error en una condición profunda', () => {
      const tree: RuleSpec = {
        kind: 'or',
        rules: [
          { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
          {
            kind: 'and',
            rules: [
              { kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' },
              { kind: 'condition', op: '>', a: 'close', b: 'rsi14' }, // price vs oscillator
            ],
          },
        ],
      }

      expect(() => buildRule(tree, CLASSES)).toThrow(InvalidStrategyDefinitionError)
    })
  })
})
