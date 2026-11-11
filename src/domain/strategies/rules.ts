import { MarketContext } from '@/domain/strategies/marketContext'

/** Referencia a una serie: alias de indicador registrado en el contexto o constante numérica. */
export type SeriesRef = string | number

/** Regla de entrada/salida: evaluación pura; solo responde "sí/no", no ejecuta órdenes (Fase 3). */
export interface Rule {
  /** Descripción estable para observabilidad/debug, p. ej. `"rsi > 30"`. */
  readonly name: string
  /** false si falta dato (calentamiento); un alias no registrado propaga `MarketContextError`. */
  evaluate(context: MarketContext): boolean
}

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

export class Not implements Rule {
  readonly name: string

  constructor(readonly rule: Rule) {
    this.name = `not(${rule.name})`
  }

  evaluate(context: MarketContext): boolean {
    return !this.rule.evaluate(context)
  }
}
