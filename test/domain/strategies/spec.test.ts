import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Constant } from '@/domain/indicators/constant'
import { Ema } from '@/domain/indicators/ema'
import { InvalidPeriodError } from '@/domain/indicators/indicator'
import { LowestLow } from '@/domain/indicators/lowestLow'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'
import { series, InvalidPriceExprError } from '@/domain/strategies/priceExpr'
import {
  All,
  CrossesAbove,
  CrossesBelow,
  Equals,
  FirstSince,
  Greater,
  Lower,
  Not,
} from '@/domain/strategies/rules'
import { StrategyAction } from '@/domain/strategies/strategy'
import { buildRule } from '@/domain/strategies/spec/build'
import { assertRuleSpec } from '@/domain/strategies/spec/validate'
import {
  buildIndicator,
  buildStrategy,
  compatibleClasses,
  InvalidStrategyDefinitionError,
  operationAliases,
  parseStrategySpec,
  priceOperandAliases,
  ruleOperandAliases,
  RuleSpec,
  seriesClasses,
  SeriesClasses,
  StrategySpec,
} from '@/domain/strategies/spec'
import { candle } from '../../support/candles'
import { contextWith } from '../../support/marketContext'

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

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
      for (const op of ['crosses_above', 'crosses_below', '>', '<', '=='] as const) {
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
      expect(() => assertRuleSpec({ kind: 'condition', op: '!=', a: 'close', b: 'ema12' })).toThrow(
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

    it('assertRuleSpec rechaza un hijo inválido en cualquier profundidad', () => {
      const malformed = {
        kind: 'and',
        rules: [
          { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
          { kind: 'not', rule: { kind: 'condition', op: 'nand', a: 'x', b: 'y' } },
        ],
      }

      expect(() => assertRuleSpec(malformed)).toThrow(InvalidStrategyDefinitionError)
    })

    it('first_since con ambas ramas válidas → no lanza (también anidado)', () => {
      const node: RuleSpec = {
        kind: 'first_since',
        since: { kind: 'condition', op: '==', a: 'low', b: 'min100' },
        then: { kind: 'and', rules: [{ kind: 'condition', op: '>', a: 'close', b: 'ema12' }] },
      }

      expect(() => assertRuleSpec(node)).not.toThrow()
      expect(() => assertRuleSpec({ kind: 'not', rule: node })).not.toThrow()
      expect(() =>
        assertRuleSpec({
          kind: 'or',
          rules: [node, { kind: 'condition', op: '<', a: 'rsi14', b: 'umbral30' }],
        }),
      ).not.toThrow()
    })

    it('first_since sin ramas o con una rama inválida → error', () => {
      expect(() => assertRuleSpec({ kind: 'first_since' })).toThrow(InvalidStrategyDefinitionError)
      expect(() =>
        assertRuleSpec({
          kind: 'first_since',
          since: { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
        }),
      ).toThrow(InvalidStrategyDefinitionError)
      expect(() =>
        assertRuleSpec({
          kind: 'first_since',
          since: { kind: 'xor', rules: [] },
          then: { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
        }),
      ).toThrow(InvalidStrategyDefinitionError)
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
      expect(
        buildRule({ kind: 'condition', op: '==', a: 'close', b: 'ema12' }, CLASSES),
      ).toBeInstanceOf(Equals)
    })

    it('condición == → igualdad exacta sobre la vela actual', () => {
      const rule = buildRule({ kind: 'condition', op: '==', a: 'close', b: 'ema12' }, CLASSES)

      expect(rule.name).toBe('close == ema12')
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [8, 8, 8, 13] }))).toBe(true) // close = 13
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [8, 8, 8, 12.999999] }))).toBe(false)
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [8, 8, 8, null] }))).toBe(false)
    })

    it('first_since → FirstSince con el árbol montado y evaluación real', () => {
      const spec: RuleSpec = {
        kind: 'first_since',
        since: { kind: 'condition', op: '==', a: 'low', b: 'ema12' },
        then: { kind: 'condition', op: '>', a: 'close', b: 'ema12' },
      }
      const rule = buildRule(spec, CLASSES)

      expect(rule).toBeInstanceOf(FirstSince)
      expect(rule.name).toBe('firstSince(low == ema12, close > ema12)')

      // Ancla en la vela 1 (low 9 == ema12 9) y primera `then` en la actual
      // (close 13 > ema12 10, sin `then` intermedias: 11 ≯ 12, 12 ≯ 12).
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [9, 12, 12, 10] }))).toBe(true)
      // Con `then` ya cumplidas después del ancla → no es la primera.
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [9, 8, 8, 10] }))).toBe(false)
      // Sin ancla (low nunca igual a ema12) → false.
      expect(rule.evaluate(contextWith(CANDLES, { ema12: [99, 99, 99, 10] }))).toBe(false)
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
      const context = contextWith(CANDLES, {
        ema12: [8, 8, 8, 10],
        rsi14: [50, 50, 50, 20],
        umbral30: [30, 30, 30, 30],
      })

      expect(buildRule(spec, CLASSES).evaluate(context)).toBe(true)

      // rsi14 por encima del umbral → la segunda condición falla
      const context2 = contextWith(CANDLES, {
        ema12: [8, 8, 8, 10],
        rsi14: [50, 50, 50, 45],
        umbral30: [30, 30, 30, 30],
      })
      expect(buildRule(spec, CLASSES).evaluate(context2)).toBe(false)
    })

    it('las series builtin son operandos válidos (close en condición)', () => {
      const rule = buildRule({ kind: 'condition', op: '>', a: 'close', b: 'ema12' }, CLASSES)
      const context = contextWith(CANDLES, { ema12: [8, 8, 8, 10] })

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

/** Spec válida de referencia (§1.4): SMA/EMA/RSI + constante, con TP/SL y trigger. */
function validSpec(): StrategySpec {
  return {
    name: 'demo',
    version: 2,
    indicators: [
      { alias: 'fast', kind: 'sma', period: 10 },
      { alias: 'slow', kind: 'ema', period: 30 },
      { alias: 'r', kind: 'rsi', period: 14 },
      { alias: 'umbral', kind: 'const', value: 30 },
    ],
    entry: {
      rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
      price: series('fast'),
      execution: 'limit',
    },
    takeProfit: {
      price: { kind: 'binary', op: '+', left: series('fast'), right: series('umbral') },
      execution: 'limit',
    },
    stopLoss: { price: series('slow'), execution: 'market' },
    triggers: [{ price: series('fast'), action: 'request_exit', execution: 'market' }],
    exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
    invalidation: { kind: 'condition', op: '<', a: 'r', b: 'umbral' },
  }
}

describe('parseStrategySpec (validación para persistencia)', () => {
  it('spec válida → la devuelve intacta', () => {
    expect(parseStrategySpec(validSpec())).toEqual(validSpec())
  })

  it('name/version/indicators con forma inválida → InvalidStrategyDefinitionError', () => {
    expect(() => parseStrategySpec({ ...validSpec(), name: '' })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() => parseStrategySpec({ ...validSpec(), version: 0 })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() => parseStrategySpec({ ...validSpec(), version: 1.5 })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() => parseStrategySpec({ ...validSpec(), indicators: 'x' })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() =>
      parseStrategySpec({ ...validSpec(), indicators: [{ alias: '', kind: 'sma', period: 5 }] }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({ ...validSpec(), indicators: [{ alias: 'x', kind: 'macd', period: 5 }] }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({ ...validSpec(), indicators: [{ alias: 'x', kind: 'sma', period: 0 }] }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({
        ...validSpec(),
        indicators: [{ alias: 'x', kind: 'const', value: Number.NaN }],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('entry: limit exige price y market lo prohíbe', () => {
    const base = validSpec()
    expect(() =>
      parseStrategySpec({ ...base, entry: { rule: base.entry.rule, execution: 'limit' } }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({
        ...base,
        entry: { rule: base.entry.rule, price: series('fast'), execution: 'market' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({
        ...base,
        entry: { rule: base.entry.rule, price: series('fast'), execution: 'stop' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('tp/sl: price y execution obligatorios', () => {
    const base = validSpec()
    expect(() => parseStrategySpec({ ...base, takeProfit: { execution: 'limit' } })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() => parseStrategySpec({ ...base, stopLoss: { price: series('slow') } })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() =>
      parseStrategySpec({ ...base, takeProfit: { price: series('slow'), execution: 'fill' } }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('triggers: action válida y reglas de fraction', () => {
    const base = validSpec()
    expect(() =>
      parseStrategySpec({
        ...base,
        triggers: [{ price: series('fast'), action: 'sell', execution: 'market' }],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    // add/reduce exigen fraction en (0, 1]
    expect(() =>
      parseStrategySpec({
        ...base,
        triggers: [{ price: series('fast'), action: 'request_add', execution: 'market' }],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({
        ...base,
        triggers: [
          { price: series('fast'), action: 'request_add', execution: 'market', fraction: 1.5 },
        ],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      parseStrategySpec({
        ...base,
        triggers: [
          { price: series('fast'), action: 'request_add', execution: 'market', fraction: 0.5 },
        ],
      }),
    ).not.toThrow()
    // entry no admite fraction
    expect(() =>
      parseStrategySpec({
        ...base,
        triggers: [
          { price: series('fast'), action: 'request_entry', execution: 'market', fraction: 0.5 },
        ],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('price con literal numérico → InvalidPriceExprError (sin precios absolutos, decisión 9)', () => {
    const base = validSpec()
    expect(() =>
      parseStrategySpec({
        ...base,
        takeProfit: { price: 99 as never, execution: 'limit' },
      }),
    ).toThrow(InvalidPriceExprError)
  })

  it('reglas con forma inválida en exitRule/invalidation → InvalidStrategyDefinitionError', () => {
    expect(() => parseStrategySpec({ ...validSpec(), exitRule: { kind: 'xor' } })).toThrow(
      InvalidStrategyDefinitionError,
    )
    expect(() => parseStrategySpec({ ...validSpec(), invalidation: 'nope' })).toThrow(
      InvalidStrategyDefinitionError,
    )
  })
})

describe('buildStrategy', () => {
  it('spec válida → construye la estrategia completa', () => {
    const strategy = buildStrategy(validSpec())

    expect(strategy.name).toBe('demo')
    expect(strategy.version).toBe(2)
    expect(strategy.toString()).toBe('demo@2')
    expect(strategy.indicators.fast).toBeInstanceOf(Sma)
    expect(strategy.indicators.slow).toBeInstanceOf(Ema)
    expect(strategy.indicators.r).toBeInstanceOf(Rsi)
    expect(strategy.indicators.umbral).toBeInstanceOf(Constant)
    expect(strategy.signals).toHaveLength(2) // entry + exitRule
    expect(strategy.signals[0]?.action).toBe(StrategyAction.RequestEntry)
    expect(strategy.signals[0]?.config.price).toEqual(series('fast'))
    expect(strategy.signals[1]?.action).toBe(StrategyAction.RequestExit)
    expect(strategy.signals[1]?.config.price).toBeUndefined() // exitRule → market
    expect(strategy.takeProfit?.execution).toBe('limit')
    expect(strategy.stopLoss?.execution).toBe('market')
    expect(strategy.triggers).toHaveLength(1)
    expect(strategy.triggers[0]?.action).toBe(StrategyAction.RequestExit)
    expect(strategy.invalidationRule).not.toBeNull()
  })

  it('entry market → la señal va sin price (presencia ⇔ limit)', () => {
    const base = validSpec()
    const strategy = buildStrategy({
      ...base,
      entry: { rule: base.entry.rule, execution: 'market' },
    })

    expect(strategy.signals[0]?.config.price).toBeUndefined()
  })

  it('alias de indicador reservado o duplicado → error', () => {
    expect(() =>
      buildStrategy({
        ...validSpec(),
        indicators: [{ alias: 'close', kind: 'sma', period: 5 }],
      }),
    ).toThrow(InvalidStrategyDefinitionError)

    expect(() =>
      buildStrategy({
        ...validSpec(),
        indicators: [
          { alias: 'fast', kind: 'sma', period: 5 },
          { alias: 'fast', kind: 'ema', period: 9 },
        ],
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('precios: oscilador o alias no registrado → error', () => {
    const base = validSpec()
    // r (RSI) no forma parte de un precio (§1.3)
    expect(() =>
      buildStrategy({
        ...base,
        entry: { rule: base.entry.rule, price: series('r'), execution: 'limit' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    // alias inexistente
    expect(() =>
      buildStrategy({
        ...base,
        entry: { rule: base.entry.rule, price: series('ghost'), execution: 'limit' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('alias de operación: disponibles según el contexto (§1.1)', () => {
    const base = validSpec()

    // entry.price sin posición → ningún alias de operación
    expect(() =>
      buildStrategy({
        ...base,
        entry: { rule: base.entry.rule, price: series('entry'), execution: 'limit' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    // tp/sl: entry sí, sl/tp no
    expect(() =>
      buildStrategy({ ...base, takeProfit: { price: series('entry'), execution: 'limit' } }),
    ).not.toThrow()
    expect(() =>
      buildStrategy({ ...base, stopLoss: { price: series('sl'), execution: 'market' } }),
    ).toThrow(InvalidStrategyDefinitionError)
    // triggers: entry/sl/tp todos
    expect(() =>
      buildStrategy({
        ...base,
        triggers: [{ price: series('tp'), action: 'request_exit', execution: 'limit' }],
      }),
    ).not.toThrow()
    // reglas: entry.rule e invalidation no; exitRule sí
    expect(() =>
      buildStrategy({
        ...base,
        entry: {
          rule: { kind: 'condition', op: '>', a: 'close', b: 'entry' },
          price: series('fast'),
          execution: 'limit',
        },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      buildStrategy({
        ...base,
        invalidation: { kind: 'condition', op: '>', a: 'close', b: 'entry' },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() =>
      buildStrategy({
        ...base,
        exitRule: { kind: 'condition', op: '>', a: 'close', b: 'entry' },
      }),
    ).not.toThrow()
  })

  it('reglas: alias no registrado o clases incompatibles → error', () => {
    const base = validSpec()
    expect(() =>
      buildStrategy({
        ...base,
        entry: {
          rule: { kind: 'condition', op: '>', a: 'ghost', b: 'fast' },
          price: series('fast'),
          execution: 'limit',
        },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
    // r (oscillator) con fast (price) → incompatibles por clase (§1.2)
    expect(() =>
      buildStrategy({
        ...base,
        entry: {
          rule: { kind: 'condition', op: 'crosses_above', a: 'r', b: 'fast' },
          price: series('fast'),
          execution: 'limit',
        },
      }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('first_since hereda las restricciones de alias de operación por ambas ramas', () => {
    const base = validSpec()
    const cond = (a: string, b: string): RuleSpec => ({ kind: 'condition', op: '>', a, b })
    const withEntryRule = (rule: RuleSpec): StrategySpec => ({
      ...base,
      entry: { rule, execution: 'market' },
    })

    // `entry` dentro de `since` → prohibido en entry.rule
    expect(() =>
      buildStrategy(
        withEntryRule({
          kind: 'first_since',
          since: cond('close', 'entry'),
          then: cond('close', 'fast'),
        }),
      ),
    ).toThrow(InvalidStrategyDefinitionError)

    // `entry` dentro de `then`, anidado en un grupo → también
    expect(() =>
      buildStrategy(
        withEntryRule({
          kind: 'first_since',
          since: cond('close', 'fast'),
          then: { kind: 'and', rules: [cond('entry', 'fast')] },
        }),
      ),
    ).toThrow(InvalidStrategyDefinitionError)

    // en exitRule sí está permitido (hay posición)
    expect(() =>
      buildStrategy({
        ...base,
        exitRule: {
          kind: 'first_since',
          since: cond('close', 'entry'),
          then: cond('close', 'fast'),
        },
      }),
    ).not.toThrow()
  })

  it('end-to-end: la estrategia construida evalúa y dispara la entrada con su precio', () => {
    const strategy = buildStrategy({
      name: 'e2e',
      version: 1,
      indicators: [{ alias: 'fast', kind: 'sma', period: 2 }],
      entry: {
        rule: { kind: 'condition', op: '>', a: 'close', b: 'fast' },
        price: series('fast'),
        execution: 'limit',
      },
    })
    // CANDLES: closes 10..13 → fast = 12.5; close (13) > 12.5 ✓
    const decision = strategy.evaluate(strategy.buildContext(CANDLES), false)

    expect(decision.action).toBe(StrategyAction.RequestEntry)
    expect(decision.price).toBe(12.5)
    expect(decision.reason).toBe('request_entry: close > fast @ fast')
  })

  it('end-to-end market: la entrada dispara sin precio en la decisión', () => {
    const base = validSpec()
    const strategy = buildStrategy({
      ...base,
      entry: {
        rule: { kind: 'condition', op: '>', a: 'close', b: 'umbral' },
        execution: 'market',
      },
    })
    // close (13) < umbral (30) → no dispara; forzamos una regla verdadera:
    const always = buildStrategy({
      ...base,
      entry: {
        rule: { kind: 'condition', op: '<', a: 'close', b: 'umbral' },
        execution: 'market',
      },
    })
    const decision = always.evaluate(always.buildContext(CANDLES), false)

    expect(strategy.evaluate(strategy.buildContext(CANDLES), false).action).toBe(
      StrategyAction.None,
    )
    expect(decision.action).toBe(StrategyAction.RequestEntry)
    expect(decision.price).toBeNull()
  })
})

describe('API para el editor (enmienda 16)', () => {
  it('seriesClasses combina builtins (vela + entry/sl/tp) e indicadores con su clase', () => {
    const classes = seriesClasses(validSpec())

    expect(classes.close).toBe('price')
    expect(classes.open).toBe('price')
    expect(classes.high).toBe('price')
    expect(classes.low).toBe('price')
    expect(classes.entry).toBe('price')
    expect(classes.sl).toBe('price')
    expect(classes.tp).toBe('price')
    expect(classes.fast).toBe('price') // sma
    expect(classes.slow).toBe('price') // ema
    expect(classes.r).toBe('oscillator') // rsi
    expect(classes.umbral).toBe('constant')
  })

  it('seriesClasses no valida la spec (sirve para drafts en edición)', () => {
    const draft = { ...validSpec(), indicators: [{ alias: 'x', kind: 'sma' }] } as never
    expect(seriesClasses(draft).x).toBe('price')
  })

  it('lowestLow se acepta en la spec y se clasifica como serie de precio', () => {
    const base = validSpec()
    const spec: StrategySpec = {
      ...base,
      indicators: [...base.indicators, { alias: 'min20', kind: 'lowestLow', period: 20 }],
    }

    expect(parseStrategySpec(spec).indicators.at(-1)).toEqual({
      alias: 'min20',
      kind: 'lowestLow',
      period: 20,
    })
    expect(seriesClasses(spec).min20).toBe('price')
  })

  it('operationAliases devuelve los alias disponibles por contexto (§1.1)', () => {
    expect(operationAliases('entry.rule')).toEqual([])
    expect(operationAliases('invalidation')).toEqual([])
    expect(operationAliases('entry.price')).toEqual([])
    expect(operationAliases('takeProfit')).toEqual(['entry'])
    expect(operationAliases('stopLoss')).toEqual(['entry'])
    expect(operationAliases('exitRule')).toEqual(['entry', 'sl', 'tp'])
    expect(operationAliases('trigger')).toEqual(['entry', 'sl', 'tp'])
  })

  it('priceOperandAliases: price/constant + alias de operación del contexto (sin osciladores)', () => {
    const classes = seriesClasses(validSpec())

    const withoutOps = priceOperandAliases(classes, [])
    expect(withoutOps).toContain('close')
    expect(withoutOps).toContain('umbral') // constante
    expect(withoutOps).toContain('fast') // sma
    expect(withoutOps).not.toContain('r') // rsi → oscilador, no es precio
    expect(withoutOps).not.toContain('entry') // alias de operación fuera de contexto

    const withEntry = priceOperandAliases(classes, ['entry'])
    expect(withEntry).toContain('entry')
    expect(withEntry).not.toContain('sl')
    expect(withEntry).not.toContain('r')

    const all = priceOperandAliases(classes, ['entry', 'sl', 'tp'])
    expect(all).toContain('tp')
  })

  it('ruleOperandAliases: todas las clases, menos las operaciones fuera de contexto', () => {
    const classes = seriesClasses(validSpec())

    const withoutOps = ruleOperandAliases(classes, [])
    expect(withoutOps).toContain('close')
    expect(withoutOps).toContain('r') // oscilador: sí forma parte de reglas (decisión 12)
    expect(withoutOps).toContain('umbral')
    expect(withoutOps).not.toContain('entry')
    expect(withoutOps).not.toContain('sl')

    const all = ruleOperandAliases(classes, ['entry', 'sl', 'tp'])
    expect(all).toContain('entry')
    expect(all).toContain('tp')
  })

  it('compatibleClasses: misma clase a ambos lados o constante (decisión 12)', () => {
    expect(compatibleClasses('price', 'price')).toBe(true)
    expect(compatibleClasses('oscillator', 'oscillator')).toBe(true)
    expect(compatibleClasses('price', 'oscillator')).toBe(false)
    expect(compatibleClasses('constant', 'oscillator')).toBe(true)
    expect(compatibleClasses('price', 'constant')).toBe(true)
    expect(compatibleClasses(undefined, 'price')).toBe(false)
  })
})

describe('buildIndicator (export para el preview)', () => {
  it('construye la clase de dominio correspondiente al kind', () => {
    expect(buildIndicator({ alias: 'a', kind: 'sma', period: 5 })).toBeInstanceOf(Sma)
    expect(buildIndicator({ alias: 'a', kind: 'ema', period: 5 })).toBeInstanceOf(Ema)
    expect(buildIndicator({ alias: 'a', kind: 'rsi', period: 14 })).toBeInstanceOf(Rsi)
    expect(buildIndicator({ alias: 'a', kind: 'lowestLow', period: 20 })).toBeInstanceOf(LowestLow)
    expect(buildIndicator({ alias: 'a', kind: 'const', value: 30 })).toBeInstanceOf(Constant)
  })

  it('propaga la validación del indicador (periodo inválido)', () => {
    expect(() => buildIndicator({ alias: 'a', kind: 'sma', period: 0 })).toThrow(InvalidPeriodError)
  })
})
