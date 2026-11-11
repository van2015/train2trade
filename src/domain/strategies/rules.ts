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

export class Crosses implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
    private readonly direction: 'above' | 'below',
  ) {
    this.name = `${a} crosses${direction === 'above' ? 'Above' : 'Below'} ${b}`
  }

  evaluate(context: MarketContext): boolean {
    const currA = resolveRef(context, this.a)
    const currB = resolveRef(context, this.b)
    const prevA = resolveRef(context, this.a, 1)
    const prevB = resolveRef(context, this.b, 1)

    if (currA === null || currB === null || prevA === null || prevB === null) return false

    return this.direction === 'above'
      ? prevA <= prevB && currA > currB
      : prevA >= prevB && currA < currB
  }
}

export class CrossesAbove extends Crosses {
  constructor(a: SeriesRef, b: SeriesRef) {
    super(a, b, 'above')
  }
}

export class CrossesBelow extends Crosses {
  constructor(a: SeriesRef, b: SeriesRef) {
    super(a, b, 'below')
  }
}

export class Comparison implements Rule {
  readonly name: string

  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
    private readonly op: '>' | '<',
  ) {
    this.name = `${a} ${op} ${b}`
  }

  evaluate(context: MarketContext): boolean {
    const a = resolveRef(context, this.a)
    const b = resolveRef(context, this.b)
    if (a === null || b === null) return false
    return this.op === '>' ? a > b : a < b
  }
}

export class Greater extends Comparison {
  constructor(a: SeriesRef, b: SeriesRef) {
    super(a, b, '>')
  }
}

export class Lower extends Comparison {
  constructor(a: SeriesRef, b: SeriesRef) {
    super(a, b, '<')
  }
}

export class Logical implements Rule {
  readonly name: string
  readonly rules: readonly Rule[]

  constructor(
    private readonly mode: 'AND' | 'OR',
    ...rules: Rule[]
  ) {
    if (rules.length === 0) {
      throw new RangeError(`${mode} requiere al menos una regla`)
    }
    this.rules = rules
    this.name = `(${rules.map((rule) => rule.name).join(` ${mode} `)})`
  }

  evaluate(context: MarketContext): boolean {
    for (const rule of this.rules) {
      const result = rule.evaluate(context)
      if (this.mode === 'AND' && !result) return false
      if (this.mode === 'OR' && result) return true
    }
    return this.mode === 'AND'
  }
}

export class All extends Logical {
  constructor(...rules: Rule[]) {
    super('AND', ...rules)
  }
}

export class Any extends Logical {
  constructor(...rules: Rule[]) {
    super('OR', ...rules)
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
