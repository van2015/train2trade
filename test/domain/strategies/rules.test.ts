import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'
import {
  All,
  Any,
  CrossesAbove,
  CrossesBelow,
  Greater,
  Lower,
  Not,
  resolveRef,
  Rule,
} from '@/domain/strategies/rules'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

const context = MarketContext.from({ candles: CANDLES })

function contextWith(indicators: Record<string, (number | null)[]>): MarketContext {
  const series: Record<string, IndicatorValue[]> = {}
  for (const [id, values] of Object.entries(indicators)) {
    series[id] = CANDLES.map((candle, index) => ({
      time: candle.time,
      value: values[index] ?? null,
    }))
  }
  return MarketContext.from({ candles: CANDLES, indicators: series })
}

const yes: Rule = { name: 'yes', evaluate: () => true }
const no: Rule = { name: 'no', evaluate: () => false }

describe('rules', () => {
  describe('resolveRef', () => {
    it('constante → devuelve el número para cualquier back', () => {
      expect(resolveRef(context, 42)).toBe(42)
      expect(resolveRef(context, 42, 5)).toBe(42)
    })

    it('alias → valor del contexto en la vela actual y en la anterior', () => {
      const withFast = contextWith({ fast: [1, 1, 1, 3] })

      expect(resolveRef(withFast, 'fast')).toBe(3)
      expect(resolveRef(withFast, 'fast', 1)).toBe(1)
    })

    it('alias no registrado → MarketContextError', () => {
      expect(() => resolveRef(context, 'missing')).toThrow(MarketContextError)
    })

    it('back negativo con alias → RangeError', () => {
      const withFast = contextWith({ fast: [1, 1, 1, 3] })

      expect(() => resolveRef(withFast, 'fast', -1)).toThrow(RangeError)
    })
  })

  describe('CrossesAbove / CrossesBelow', () => {
    it('CrossesAbove es true cuando a cruza por encima de la constante en la última vela', () => {
      const withFast = contextWith({ fast: [1, 1, 1, 3] })

      expect(new CrossesAbove('fast', 2).evaluate(withFast)).toBe(true)
    })

    it('sin cruce (siempre por encima o siempre por debajo) → false', () => {
      expect(new CrossesAbove('fast', 2).evaluate(contextWith({ fast: [3, 3, 3, 3] }))).toBe(false)
      expect(new CrossesAbove('fast', 2).evaluate(contextWith({ fast: [1, 1, 1, 1] }))).toBe(false)
    })

    it('un cruce por debajo no dispara CrossesAbove, y viceversa sí dispara CrossesBelow', () => {
      const withFast = contextWith({ fast: [3, 3, 3, 1] })

      expect(new CrossesAbove('fast', 2).evaluate(withFast)).toBe(false)
      expect(new CrossesBelow('fast', 2).evaluate(withFast)).toBe(true)
    })

    it('cruce entre dos alias de indicadores', () => {
      const withSeries = contextWith({ fast: [1, 1, 1, 3], slow: [2, 2, 2, 2] })

      expect(new CrossesAbove('fast', 'slow').evaluate(withSeries)).toBe(true)
    })

    it('calentamiento (null en la actual o en la anterior) → false', () => {
      expect(new CrossesAbove('fast', 2).evaluate(contextWith({ fast: [1, 1, 3, null] }))).toBe(
        false,
      )
      expect(new CrossesAbove('fast', 2).evaluate(contextWith({ fast: [1, 1, null, 3] }))).toBe(
        false,
      )
    })

    it('cruce desde la igualdad (prev = b, curr > b) → true', () => {
      const withFast = contextWith({ fast: [1, 1, 2, 3] })

      expect(new CrossesAbove('fast', 2).evaluate(withFast)).toBe(true)
    })
  })

  describe('Greater / Lower', () => {
    it('Greater: true con a > b; false con a <= b o dato faltante', () => {
      expect(new Greater('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, 75] }))).toBe(true)
      expect(new Greater('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, 25] }))).toBe(false)
      expect(new Greater('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, null] }))).toBe(false)
    })

    it('Lower: true con a < b; false con a >= b o dato faltante', () => {
      expect(new Lower('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, 25] }))).toBe(true)
      expect(new Lower('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, 75] }))).toBe(false)
      expect(new Lower('rsi', 30).evaluate(contextWith({ rsi: [50, 50, 50, null] }))).toBe(false)
    })
  })

  describe('All / Any / Not', () => {
    it('All es true solo con todas verdaderas, con cortocircuito', () => {
      expect(new All(yes, yes).evaluate(context)).toBe(true)
      expect(new All(yes, no).evaluate(context)).toBe(false)

      let calls = 0
      const spy: Rule = {
        name: 'spy',
        evaluate: () => {
          calls += 1
          return false
        },
      }
      new All(no, spy).evaluate(context)
      expect(calls).toBe(0)
    })

    it('All sin reglas → RangeError', () => {
      expect(() => new All()).toThrow(RangeError)
    })

    it('Any es true con alguna verdadera, con cortocircuito', () => {
      expect(new Any(yes, no).evaluate(context)).toBe(true)
      expect(new Any(no, no).evaluate(context)).toBe(false)

      let calls = 0
      const spy: Rule = {
        name: 'spy',
        evaluate: () => {
          calls += 1
          return true
        },
      }
      new Any(yes, spy).evaluate(context)
      expect(calls).toBe(0)
    })

    it('Any sin reglas → RangeError', () => {
      expect(() => new Any()).toThrow(RangeError)
    })

    it('Not invierte el resultado', () => {
      expect(new Not(yes).evaluate(context)).toBe(false)
      expect(new Not(no).evaluate(context)).toBe(true)
    })
  })

  describe('name (observabilidad)', () => {
    it('descripciones de las reglas básicas', () => {
      expect(new Greater('rsi', 30).name).toBe('rsi > 30')
      expect(new CrossesAbove('fast', 'slow').name).toBe('fast crossesAbove slow')
    })

    it('All une con AND y Not envuelve en not(...)', () => {
      expect(new All(yes, no).name).toBe('(yes AND no)')
      expect(new Not(yes).name).toBe('not(yes)')
    })
  })
})
