import { MarketContext } from '@/domain/strategies/marketContext'

/** Referencia a una serie: alias de indicador registrado en el contexto o constante numérica. */
export type SeriesRef = string | number

/**
 * Regla de entrada/salida: evaluación pura sobre un `MarketContext`.
 * Las reglas no ejecutan órdenes (eso es Fase 3); solo responden "sí/no".
 */
export interface Rule {
  /** Descripción estable para observabilidad/debug, p. ej. `"rsi > 30"`. */
  readonly name: string
  /** false si falta dato (calentamiento); un alias no registrado propaga `MarketContextError`. */
  evaluate(context: MarketContext): boolean
}

/** Resuelve `ref` hace `back` velas: constante → el número; alias → `context.value(...)`. */
export function resolveRef(context: MarketContext, ref: SeriesRef, back?: number): number | null {
  if (typeof ref === 'number') return ref
  return context.value(ref, back)
}

function crosses(
  context: MarketContext,
  a: SeriesRef,
  b: SeriesRef,
  direction: 'above' | 'below',
): boolean {
  const currA = resolveRef(context, a)
  const currB = resolveRef(context, b)
  const prevA = resolveRef(context, a, 1)
  const prevB = resolveRef(context, b, 1)

  if (currA === null || currB === null || prevA === null || prevB === null) return false

  return direction === 'above' ? prevA <= prevB && currA > currB : prevA >= prevB && currA < currB
}

/** `a` cruza por encima de `b` en la vela actual: `prev(a) <= prev(b)` y `curr(a) > curr(b)`. */
export class CrossesAbove implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
  ) {
    this.name = `${a} crossesAbove ${b}`
  }

  evaluate(context: MarketContext): boolean {
    return crosses(context, this.a, this.b, 'above')
  }
}

/** `a` cruza por debajo de `b` en la vela actual: `prev(a) >= prev(b)` y `curr(a) < curr(b)`. */
export class CrossesBelow implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
  ) {
    this.name = `${a} crossesBelow ${b}`
  }

  evaluate(context: MarketContext): boolean {
    return crosses(context, this.a, this.b, 'below')
  }
}

/** Estado (no cruce): `a > b` en la vela actual. false si falta dato. */
export class Greater implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
  ) {
    this.name = `${a} > ${b}`
  }

  evaluate(context: MarketContext): boolean {
    const a = resolveRef(context, this.a)
    const b = resolveRef(context, this.b)
    return a !== null && b !== null && a > b
  }
}

/** Estado (no cruce): `a < b` en la vela actual. false si falta dato. */
export class Lower implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
  ) {
    this.name = `${a} < ${b}`
  }

  evaluate(context: MarketContext): boolean {
    const a = resolveRef(context, this.a)
    const b = resolveRef(context, this.b)
    return a !== null && b !== null && a < b
  }
}

/** Todas las reglas verdaderas, con cortocircuito. 0 reglas → RangeError. */
export class All implements Rule {
  readonly name: string
  readonly rules: readonly Rule[]

  constructor(...rules: Rule[]) {
    if (rules.length === 0) {
      throw new RangeError('All requiere al menos una regla')
    }
    this.rules = rules
    this.name = `(${rules.map((rule) => rule.name).join(' AND ')})`
  }

  evaluate(context: MarketContext): boolean {
    for (const rule of this.rules) {
      if (!rule.evaluate(context)) return false
    }
    return true
  }
}

/** Al menos una verdadera, con cortocircuito. 0 reglas → RangeError. */
export class Any implements Rule {
  readonly name: string
  readonly rules: readonly Rule[]

  constructor(...rules: Rule[]) {
    if (rules.length === 0) {
      throw new RangeError('Any requiere al menos una regla')
    }
    this.rules = rules
    this.name = `(${rules.map((rule) => rule.name).join(' OR ')})`
  }

  evaluate(context: MarketContext): boolean {
    for (const rule of this.rules) {
      if (rule.evaluate(context)) return true
    }
    return false
  }
}

/** Negación de una regla. */
export class Not implements Rule {
  readonly name: string

  constructor(readonly rule: Rule) {
    this.name = `not(${rule.name})`
  }

  evaluate(context: MarketContext): boolean {
    return !this.rule.evaluate(context)
  }
}
