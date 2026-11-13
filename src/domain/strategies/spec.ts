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
import { InvalidStrategyDefinitionError } from '@/domain/strategies/strategy'

export { InvalidStrategyDefinitionError }

/** Clase de una serie: decide qué puede compararse con qué (decisión 12). */
export type SeriesClass = 'price' | 'oscillator' | 'constant'

/** Mapa alias → clase (indicadores de la spec + series builtin + alias de operación). */
export type SeriesClasses = Readonly<Record<string, SeriesClass>>

/** Operador de una condición simple. */
export type ConditionOp = 'crosses_above' | 'crosses_below' | '>' | '<'

/**
 * Regla como árbol arbitrario de condiciones (decisión 11): `condition` es la
 * hoja binaria; `and`/`or` combinan ≥ 1 hijo; `not` invierte. Los operandos
 * son alias (sin literales numéricos: los umbrales son indicadores `const`).
 */
export type RuleSpec =
  | { kind: 'condition'; op: ConditionOp; a: string; b: string }
  | { kind: 'and'; rules: RuleSpec[] }
  | { kind: 'or'; rules: RuleSpec[] }
  | { kind: 'not'; rule: RuleSpec }

/** Series builtin (vela actual) y alias de operación: todos de clase `price`. */
const BUILTIN_CLASSES: SeriesClasses = Object.freeze({
  close: 'price',
  open: 'price',
  high: 'price',
  low: 'price',
  entry: 'price',
  sl: 'price',
  tp: 'price',
})

/**
 * Valida la forma del árbol (recursiva): hoja con operador y alias no vacíos,
 * `and`/`or` con ≥ 1 hijo, `not` con regla. Cualquier problema →
 * `InvalidStrategyDefinitionError` en el primer fallo.
 */
export function assertRuleSpec(value: unknown): asserts value is RuleSpec {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('se esperaba un nodo de regla', value)
  }

  switch (value.kind) {
    case 'condition': {
      const { op, a, b } = value
      if (op !== 'crosses_above' && op !== 'crosses_below' && op !== '>' && op !== '<') {
        throw new InvalidStrategyDefinitionError('operador de condición desconocido', op)
      }
      assertAlias(a, 'a')
      assertAlias(b, 'b')
      return
    }
    case 'and':
    case 'or': {
      if (!Array.isArray(value.rules) || value.rules.length === 0) {
        throw new InvalidStrategyDefinitionError(
          `"${value.kind}" requiere al menos una regla`,
          value.rules,
        )
      }
      for (const rule of value.rules) assertRuleSpec(rule)
      return
    }
    case 'not':
      assertRuleSpec(value.rule)
      return
    default:
      throw new InvalidStrategyDefinitionError('nodo de regla desconocido', value.kind)
  }
}

/**
 * Construye la regla de dominio validando forma **y** clases por condición
 * (decisión 12): ambos operandos de la misma clase (`price`↔`price`,
 * `oscillator`↔`oscillator`); `constant` es compatible con cualquier otra;
 * alias no registrado → error. La validación recorre todo el árbol.
 */
export function buildRule(spec: RuleSpec, classes: SeriesClasses): Rule {
  assertRuleSpec(spec)
  const catalog: SeriesClasses = { ...BUILTIN_CLASSES, ...classes }
  return toRule(spec, catalog)
}

function toRule(spec: RuleSpec, classes: SeriesClasses): Rule {
  switch (spec.kind) {
    case 'condition':
      return toCondition(spec, classes)
    case 'and':
      return new All(...spec.rules.map((rule) => toRule(rule, classes)))
    case 'or':
      return new Any(...spec.rules.map((rule) => toRule(rule, classes)))
    case 'not':
      return new Not(toRule(spec.rule, classes))
  }
}

function toCondition(spec: Extract<RuleSpec, { kind: 'condition' }>, classes: SeriesClasses): Rule {
  const classA = classOf(spec.a, classes)
  const classB = classOf(spec.b, classes)
  if (!compatible(classA, classB)) {
    throw new InvalidStrategyDefinitionError(
      `no se pueden comparar series de clase "${classA}" con "${classB}"`,
      `${spec.a} ${spec.op} ${spec.b}`,
    )
  }

  switch (spec.op) {
    case 'crosses_above':
      return new CrossesAbove(spec.a, spec.b)
    case 'crosses_below':
      return new CrossesBelow(spec.a, spec.b)
    case '>':
      return new Greater(spec.a, spec.b)
    case '<':
      return new Lower(spec.a, spec.b)
  }
}

/** Clase del alias; no registrado → error de definición. */
function classOf(alias: string, classes: SeriesClasses): SeriesClass {
  const found = classes[alias]
  if (found === undefined) {
    throw new InvalidStrategyDefinitionError('el alias no está registrado en la estrategia', alias)
  }
  return found
}

/** Misma clase a ambos lados, o `constant` por cualquier lado. */
function compatible(a: SeriesClass, b: SeriesClass): boolean {
  return a === b || a === 'constant' || b === 'constant'
}

function assertAlias(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value === '') {
    throw new InvalidStrategyDefinitionError(
      `el operando "${field}" debe ser un alias no vacío`,
      value,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
