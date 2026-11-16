import { SignalAction, StrategyAction } from '@/domain/strategies/strategy'
import {
  IndicatorSpec,
  OperationContext,
  SeriesClass,
  SeriesClasses,
  StrategySpec,
  TriggerAction,
} from '@/domain/strategies/spec/types'

/**
 * Catálogo de series, alias y acciones de la spec (enmienda 16): fuente única
 * para `buildStrategy` (semántica) y para el editor (selectores de operandos).
 * Vive separado de `validate`/`build` porque es una consulta sobre una spec
 * **en construcción** (draft), no una validación ni una construcción.
 */

/** Series builtin (vela actual) y alias de operación: todos de clase `price`. */
export const BUILTIN_CLASSES: SeriesClasses = Object.freeze({
  close: 'price',
  open: 'price',
  high: 'price',
  low: 'price',
  entry: 'price',
  sl: 'price',
  tp: 'price',
})

/** Alias de operación (§1.1): disponibles según el contexto de la expresión. */
export const OPERATION_ALIASES: readonly string[] = ['entry', 'sl', 'tp']

/**
 * Alias de operación disponibles en cada contexto (enmienda 16, fuente única
 * para `buildStrategy` y para el selector de operandos del editor): prohibidos
 * donde no hay posición (`entry.rule`, `invalidation`, `entry.price`); solo
 * `entry` en TP/SL; los tres en `exitRule` y triggers.
 */
export function operationAliases(context: OperationContext): readonly string[] {
  switch (context) {
    case 'entry.rule':
    case 'entry.price':
    case 'invalidation':
      return []
    case 'takeProfit':
    case 'stopLoss':
      return ['entry']
    case 'exitRule':
    case 'trigger':
      return OPERATION_ALIASES
  }
}

/** Reservados: no pueden ser alias de indicador (los usaría el builtin). */
export const RESERVED_ALIASES: ReadonlySet<string> = new Set(Object.keys(BUILTIN_CLASSES))

/** Mapa TriggerAction (string) → acción del dominio. */
export const TRIGGER_ACTIONS: Record<TriggerAction, SignalAction> = {
  request_entry: StrategyAction.RequestEntry,
  request_add: StrategyAction.RequestAdd,
  request_reduce: StrategyAction.RequestReduce,
  request_exit: StrategyAction.RequestExit,
}

/**
 * ¿Dos clases son comparables en una condición? (misma clase o `constant`
 * por cualquier lado; `undefined` = alias no registrado → no compatible).
 * Fuente única de la decisión 12 para `buildStrategy` y el editor.
 */
export function compatibleClasses(a: SeriesClass | undefined, b: SeriesClass | undefined): boolean {
  if (a === undefined || b === undefined) return false
  return a === b || a === 'constant' || b === 'constant'
}

/**
 * Mapa de clases de series de una spec (enmienda 16): builtins (vela actual +
 * `entry`/`sl`/`tp`) + indicadores. **No valida** la spec: sirve mientras el
 * editor tiene un draft en construcción.
 */
export function seriesClasses(spec: StrategySpec): SeriesClasses {
  const classes: Record<string, SeriesClass> = {}
  for (const indicator of spec.indicators) classes[indicator.alias] = classOfKind(indicator.kind)
  return { ...BUILTIN_CLASSES, ...classes }
}

/**
 * Alias disponibles como operandos de una expresión de precio (enmienda 16):
 * clases `price`/`constant` (los osciladores no forman precios) + los alias de
 * operación permitidos en el contexto. `classes` sale de `seriesClasses`.
 */
export function priceOperandAliases(
  classes: SeriesClasses,
  operations: readonly string[],
): string[] {
  return Object.keys(classes).filter((alias) => {
    if (alias === '') return false
    if (OPERATION_ALIASES.includes(alias)) return operations.includes(alias)
    return classes[alias] !== 'oscillator'
  })
}

/**
 * Alias disponibles como operandos de una **regla** (enmienda 16): cualquier
 * clase (la compatibilidad se decide por condición con `compatibleClasses`)
 * salvo las operaciones no permitidas en el contexto.
 */
export function ruleOperandAliases(
  classes: SeriesClasses,
  operations: readonly string[],
): string[] {
  return Object.keys(classes).filter((alias) => {
    if (alias === '') return false
    if (OPERATION_ALIASES.includes(alias)) return operations.includes(alias)
    return true
  })
}

/** Clase del indicador (§1.3): SMA/EMA/mínimo sobre precio, RSI oscilador, const. */
export function classOfKind(kind: IndicatorSpec['kind']): SeriesClass {
  if (kind === 'rsi') return 'oscillator'
  if (kind === 'const') return 'constant'
  return 'price'
}
