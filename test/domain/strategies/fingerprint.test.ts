import { describe, expect, it } from 'vitest'
import { canonicalJson, strategyFingerprint } from '@/domain/strategies/fingerprint'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction, StrategyDefinition } from '@/domain/strategies/strategy'

function build(overrides: Partial<StrategyDefinition> = {}): Strategy {
  return new Strategy({
    name: 'cross-e2e',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
    ...overrides,
  })
}

describe('canonicalJson — serialización canónica (§12C)', () => {
  it('ordena las claves alfabéticamente de forma recursiva', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ z: { y: 1, x: [3, 1] }, a: null })).toBe(
      '{"a":null,"z":{"x":[3,1],"y":1}}',
    )
  })

  it('los arrays conservan su orden', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalJson([{ b: 1, a: 2 }, 'x'])).toBe('[{"a":2,"b":1},"x"]')
  })

  it('serializa las instancias por sus props propios (los métodos del prototipo no cuentan)', () => {
    expect(canonicalJson(new Sma(3))).toBe('{"name":"sma","period":3}')
  })

  it('omite funciones y undefined (callbacks y campos ausentes)', () => {
    expect(canonicalJson({ b: undefined, a: 1, fn: () => 1 })).toBe('{"a":1}')
    expect(canonicalJson([1, () => 2, 3])).toBe('[1,3]')
    expect(canonicalJson({ name: 'always', evaluate: () => true })).toBe('{"name":"always"}')
  })

  it('primitivas, null y no finitos', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(undefined)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(42)).toBe('42')
    expect(canonicalJson('a"b')).toBe('"a\\"b"')
    expect(canonicalJson(Number.NaN)).toBe('null')
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe('null')
  })

  it('los Map se serializan como registro con claves ordenadas', () => {
    expect(
      canonicalJson(
        new Map([
          ['b', 1],
          ['a', 2],
        ]),
      ),
    ).toBe('{"a":2,"b":1}')
  })

  it('las fechas usan su representación ISO', () => {
    expect(canonicalJson({ at: new Date(0), z: 1 })).toBe('{"at":"1970-01-01T00:00:00.000Z","z":1}')
  })

  it('es estable: la misma entrada produce siempre la misma salida', () => {
    const value = { z: [1, { b: 2, a: 3 }], name: 'x' }
    expect(canonicalJson(value)).toBe(canonicalJson(value))
  })
})

describe('strategyFingerprint — huella reproducible (§12C)', () => {
  it('misma definición reconstruida → misma huella (hex de 8 dígitos)', () => {
    const first = strategyFingerprint(build())
    expect(first).toMatch(/^[0-9a-f]{8}$/)
    expect(strategyFingerprint(build())).toBe(first)
  })

  it('cualquier cambio en la definición produce una huella distinta', () => {
    const base = strategyFingerprint(build())

    const changed: Strategy[] = [
      build({ name: 'otro' }),
      build({ version: 2 }),
      build({ indicators: { fast: new Sma(4), slow: new Sma(3) } }), // periodo
      build({ indicators: { fast: new Sma(2), slow: new Sma(3), extra: new Sma(5) } }), // añadido
      build({ indicators: { slow: new Sma(2), fast: new Sma(3) } }), // alias intercambiados
      build({
        signals: [
          new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
          new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
        ],
      }), // orden de señales
      build({
        signals: [new Signal(StrategyAction.RequestEntry, new CrossesAbove('slow', 'fast'))],
      }), // regla distinta
      build({ invalidationRule: { name: 'veto', evaluate: () => true } }), // veto nuevo
    ]

    for (const strategy of changed) {
      expect(strategyFingerprint(strategy)).not.toBe(base)
    }
  })

  it('una regla con función (evaluate) no rompe la serialización', () => {
    const custom = (): Strategy =>
      new Strategy({
        name: 'custom',
        signals: [
          new Signal(StrategyAction.RequestEntry, { name: 'always', evaluate: () => true }),
        ],
      })

    expect(strategyFingerprint(custom())).toBe(strategyFingerprint(custom()))
  })
})
