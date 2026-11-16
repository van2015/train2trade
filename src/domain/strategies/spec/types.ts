import { PriceExpr } from '@/domain/strategies/priceExpr'
import { OrderExecution, PriceLevel } from '@/domain/strategies/strategy'

/**
 * Tipos serializables de la spec de estrategia (§1.4) — solo formas, sin
 * validación ni construcción: la validación de la forma vive en `validate`
 * y la semántica/construcción en `build`.
 */

/** Clase de una serie: decide qué puede compararse con qué (decisión 12). */
export type SeriesClass = 'price' | 'oscillator' | 'constant'

/** Mapa alias → clase (indicadores de la spec + series builtin + alias de operación). */
export type SeriesClasses = Readonly<Record<string, SeriesClass>>

/** Operador de una condición simple. `==` = igualdad exacta (ver `Comparison`). */
export type ConditionOp = 'crosses_above' | 'crosses_below' | '>' | '<' | '=='

/**
 * Regla como árbol arbitrario de condiciones (decisión 11): `condition` es la
 * hoja binaria; `and`/`or` combinan ≥ 1 hijo; `not` invierte; `first_since`
 * añade la secuencia con ancla ("primera vez que `then` desde la última vez
 * que `since`"). Los operandos son alias (sin literales numéricos: los
 * umbrales son indicadores `const`).
 */
export type RuleSpec =
  | { kind: 'condition'; op: ConditionOp; a: string; b: string }
  | { kind: 'and'; rules: RuleSpec[] }
  | { kind: 'or'; rules: RuleSpec[] }
  | { kind: 'not'; rule: RuleSpec }
  | { kind: 'first_since'; since: RuleSpec; then: RuleSpec }

/** Indicador serializable (§1.4): catálogo SMA/EMA/RSI/mínimo + constante. */
export type IndicatorSpec =
  | { alias: string; kind: 'sma' | 'ema' | 'rsi' | 'lowestLow'; period: number }
  | { alias: string; kind: 'const'; value: number }

/** Acciones de trigger (§1.4): las cuatro acciones de señal como string. */
export type TriggerAction = 'request_entry' | 'request_add' | 'request_reduce' | 'request_exit'

/**
 * Entrada de la spec: `limit` exige `price` (orden `Limit` en la expresión);
 * `market` lo prohíbe (la orden va a mercado sin precio — decisión 6).
 */
export type EntrySpec =
  { rule: RuleSpec; price: PriceExpr; execution: 'limit' } | { rule: RuleSpec; execution: 'market' }

/**
 * Especificación serializable de una estrategia (§1.4). Sin precios absolutos
 * (decisión 9): todo precio es una expresión sobre indicadores y relaciones
 * entre ellos.
 */
export interface StrategySpec {
  name: string
  version: number
  indicators: IndicatorSpec[]
  entry: EntrySpec
  /** Toque `high >= tp` con posición abierta → salida (§1.5). */
  takeProfit?: PriceLevel
  /** Toque `low <= sl` con posición abierta → salida (§1.5). */
  stopLoss?: PriceLevel
  /** Disparadores por toque direccional (§1.5); `fraction` solo en add/reduce. */
  triggers?: readonly TriggerSpec[]
  /** Salida por regla (market); en test-forward la decide el usuario. */
  exitRule?: RuleSpec
  /** Veto → Invalidate. */
  invalidation?: RuleSpec
}

/** Trigger serializable: toque de precio + acción + ejecución (+ fracción). */
export interface TriggerSpec {
  price: PriceExpr
  action: TriggerAction
  execution: OrderExecution
  fraction?: number
}

/** Contextos donde pueden aparecer alias de operación (§1.1 / enmienda 16). */
export type OperationContext =
  'entry.rule' | 'entry.price' | 'exitRule' | 'invalidation' | 'takeProfit' | 'stopLoss' | 'trigger'
