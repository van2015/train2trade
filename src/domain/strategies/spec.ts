import { Constant } from '@/domain/indicators/constant'
import { Ema } from '@/domain/indicators/ema'
import { Indicator } from '@/domain/indicators/indicator'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'
import { assertPriceExpr, PriceExpr } from '@/domain/strategies/priceExpr'
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
  InvalidStrategyDefinitionError,
  isUnitFraction,
  OrderExecution,
  PriceLevel,
  Signal,
  SignalAction,
  Strategy,
  StrategyAction,
  Trigger,
} from '@/domain/strategies/strategy'

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

/** Indicador serializable (§1.4): catálogo actual SMA/EMA/RSI + constante. */
export type IndicatorSpec =
  | { alias: string; kind: 'sma' | 'ema' | 'rsi'; period: number }
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

/** Alias de operación (§1.1): disponibles según el contexto de la expresión. */
const OPERATION_ALIASES: readonly string[] = ['entry', 'sl', 'tp']

/** Contextos donde pueden aparecer alias de operación (§1.1 / enmienda 16). */
export type OperationContext =
  'entry.rule' | 'entry.price' | 'exitRule' | 'invalidation' | 'takeProfit' | 'stopLoss' | 'trigger'

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
const RESERVED_ALIASES: ReadonlySet<string> = new Set(Object.keys(BUILTIN_CLASSES))

/** Mapa TriggerAction (string) → acción del dominio. */
const TRIGGER_ACTIONS: Record<TriggerAction, SignalAction> = {
  request_entry: StrategyAction.RequestEntry,
  request_add: StrategyAction.RequestAdd,
  request_reduce: StrategyAction.RequestReduce,
  request_exit: StrategyAction.RequestExit,
}

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
 * alias no registrado → error. El catálogo fusiona los builtins (que incluyen
 * los alias de operación).
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
  if (!compatibleClasses(classA, classB)) {
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

/**
 * ¿Dos clases son comparables en una condición? (misma clase o `constant`
 * por cualquier lado; `undefined` = alias no registrado → no compatible).
 * Fuente única de la decisión 12 para `buildStrategy` y el editor.
 */
export function compatibleClasses(a: SeriesClass | undefined, b: SeriesClass | undefined): boolean {
  if (a === undefined || b === undefined) return false
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

/* ------------------------------------------------------------------ */
/* StrategySpec: parse (forma) + build (semántica + construcción)      */
/* ------------------------------------------------------------------ */

/**
 * Valida la **forma** completa de una spec (§1.4): tipos, rangos, reglas
 * limit⇔price, aliases no reservados/únicos y reglas de fraction. Es lo que
 * usa la persistencia: el repositorio envuelve sus errores en
 * `CorruptedStorageError` (mismo patrón que `Trade.from`).
 */
export function assertStrategySpec(value: unknown): asserts value is StrategySpec {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('la spec debe ser un objeto', value)
  }

  const {
    name,
    version,
    indicators,
    entry,
    takeProfit,
    stopLoss,
    triggers,
    exitRule,
    invalidation,
  } = value

  if (typeof name !== 'string' || name.trim() === '') {
    throw new InvalidStrategyDefinitionError('el name no puede estar vacío', name)
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new InvalidStrategyDefinitionError('la version debe ser un entero >= 1', version)
  }
  if (!Array.isArray(indicators)) {
    throw new InvalidStrategyDefinitionError('indicators debe ser un array', indicators)
  }
  const seen = new Set<string>()
  for (const indicator of indicators) assertIndicatorSpec(indicator, seen)

  if (!isRecord(entry)) {
    throw new InvalidStrategyDefinitionError('entry debe ser un objeto', entry)
  }
  assertEntrySpec(entry)

  for (const key of ['takeProfit', 'stopLoss'] as const) {
    const level = value[key]
    if (level === undefined) continue
    if (!isRecord(level)) {
      throw new InvalidStrategyDefinitionError(`${key} debe ser un objeto`, level)
    }
    if (level.price === undefined) {
      throw new InvalidStrategyDefinitionError(`${key}.price es obligatoria`, undefined)
    }
    assertPriceExpr(level.price)
    assertExecution(level.execution, `${key}.execution`)
  }

  if (triggers !== undefined) {
    if (!Array.isArray(triggers)) {
      throw new InvalidStrategyDefinitionError('triggers debe ser un array', triggers)
    }
    for (const trigger of triggers) assertTriggerSpec(trigger)
  }

  if (exitRule !== undefined) assertRuleSpec(exitRule)
  if (invalidation !== undefined) assertRuleSpec(invalidation)
}

/** `parseStrategySpec`: alias de `assertStrategySpec` para la persistencia. */
export function parseStrategySpec(value: unknown): StrategySpec {
  assertStrategySpec(value)
  return value
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

/**
 * Construye la `Strategy` del dominio (§1.4): valida la semántica de la spec
 * (alias registrados, clases por contexto de operación) y ensambla indicadores,
 * señales (entry + exitRule), niveles TP/SL, triggers y veto.
 */
export function buildStrategy(spec: StrategySpec): Strategy {
  const parsed = parseStrategySpec(spec)

  // 1. Indicadores → instancia + mapa de clases.
  const indicators: Record<string, Indicator> = {}
  const classes: Record<string, SeriesClass> = {}
  for (const indicator of parsed.indicators) {
    indicators[indicator.alias] = buildIndicator(indicator)
    classes[indicator.alias] = classOfKind(indicator.kind)
  }
  const allClasses: SeriesClasses = { ...BUILTIN_CLASSES, ...classes }

  // 2. Reglas: operandos de operación según contexto (§1.1) + clases (§1.2).
  assertRuleOperations(parsed.entry.rule, operationAliases('entry.rule'), 'entry.rule')
  const entryRule = buildRule(parsed.entry.rule, classes)

  // 3. Señales: entry (limit adjunta price; market no) + exitRule (market).
  const entryConfig: { price?: PriceExpr } = {}
  if (parsed.entry.execution === 'limit') {
    assertPriceOperands(
      parsed.entry.price,
      allClasses,
      operationAliases('entry.price'),
      'entry.price',
    )
    entryConfig.price = parsed.entry.price
  }
  const signals: Signal[] = [new Signal(StrategyAction.RequestEntry, entryRule, entryConfig)]

  if (parsed.exitRule !== undefined) {
    assertRuleOperations(parsed.exitRule, operationAliases('exitRule'), 'exitRule')
    signals.push(new Signal(StrategyAction.RequestExit, buildRule(parsed.exitRule, classes)))
  }

  // 4. Niveles TP/SL: `entry` disponible, `sl`/`tp` sin auto-referencia (§1.1).
  let takeProfit: PriceLevel | undefined
  if (parsed.takeProfit !== undefined) {
    assertPriceOperands(
      parsed.takeProfit.price,
      allClasses,
      operationAliases('takeProfit'),
      'takeProfit.price',
    )
    takeProfit = parsed.takeProfit
  }
  let stopLoss: PriceLevel | undefined
  if (parsed.stopLoss !== undefined) {
    assertPriceOperands(
      parsed.stopLoss.price,
      allClasses,
      operationAliases('stopLoss'),
      'stopLoss.price',
    )
    stopLoss = parsed.stopLoss
  }

  // 5. Triggers: los tres alias de operación disponibles (§1.1).
  const triggers = parsed.triggers?.map((trigger) => {
    assertPriceOperands(trigger.price, allClasses, operationAliases('trigger'), 'trigger.price')
    return new Trigger({
      price: trigger.price,
      action: TRIGGER_ACTIONS[trigger.action],
      execution: trigger.execution,
      fraction: trigger.fraction,
    })
  })

  // 6. Veto: sin alias de operación (mismo criterio que entry.rule).
  let invalidationRule: Rule | undefined
  if (parsed.invalidation !== undefined) {
    assertRuleOperations(parsed.invalidation, operationAliases('invalidation'), 'invalidation')
    invalidationRule = buildRule(parsed.invalidation, classes)
  }

  return new Strategy({
    name: parsed.name,
    version: parsed.version,
    indicators,
    signals,
    invalidationRule,
    takeProfit,
    stopLoss,
    triggers,
  })
}

/** Forma del indicador: alias no reservado/único + kind/period/value válidos. */
function assertIndicatorSpec(value: unknown, seen: Set<string>): void {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('el indicador debe ser un objeto', value)
  }
  const { alias, kind, period, value: constValue } = value

  if (typeof alias !== 'string' || alias === '') {
    throw new InvalidStrategyDefinitionError('el alias del indicador no puede estar vacío', alias)
  }
  if (RESERVED_ALIASES.has(alias)) {
    throw new InvalidStrategyDefinitionError(
      `el alias "${alias}" está reservado (series builtin y alias de operación)`,
      alias,
    )
  }
  if (seen.has(alias)) {
    throw new InvalidStrategyDefinitionError(`alias de indicador duplicado: "${alias}"`, alias)
  }
  seen.add(alias)

  if (kind === 'const') {
    if (typeof constValue !== 'number' || !Number.isFinite(constValue)) {
      throw new InvalidStrategyDefinitionError(
        'un indicador constante requiere un value numérico finito',
        constValue,
      )
    }
    return
  }
  if (kind !== 'sma' && kind !== 'ema' && kind !== 'rsi') {
    throw new InvalidStrategyDefinitionError(
      'kind de indicador desconocido (sma/ema/rsi/const)',
      kind,
    )
  }
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new InvalidStrategyDefinitionError(
      'el periodo del indicador debe ser un entero >= 1',
      period,
    )
  }
}

/** Forma de la entrada: regla + ejecución, con `price` ⇔ limit (§1.4). */
function assertEntrySpec(entry: Record<string, unknown>): void {
  assertRuleSpec(entry.rule)
  const execution = entry.execution
  if (execution !== 'limit' && execution !== 'market') {
    throw new InvalidStrategyDefinitionError(
      'entry.execution debe ser "limit" o "market"',
      execution,
    )
  }
  if (execution === 'limit') {
    if (entry.price === undefined) {
      throw new InvalidStrategyDefinitionError(
        'entry.price es obligatoria con execution "limit"',
        undefined,
      )
    }
    assertPriceExpr(entry.price)
  } else if (entry.price !== undefined) {
    throw new InvalidStrategyDefinitionError(
      'execution "market" no admite entry.price',
      entry.price,
    )
  }
}

/** Forma del trigger: price + action + execution + fraction por acción (§1.4). */
function assertTriggerSpec(value: unknown): void {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('el trigger debe ser un objeto', value)
  }
  if (value.price === undefined) {
    throw new InvalidStrategyDefinitionError('trigger.price es obligatoria', undefined)
  }
  assertPriceExpr(value.price)

  const action = value.action
  if (typeof action !== 'string' || !(action in TRIGGER_ACTIONS)) {
    throw new InvalidStrategyDefinitionError(
      'trigger.action debe ser request_entry/request_add/request_reduce/request_exit',
      action,
    )
  }
  assertExecution(value.execution, 'trigger.execution')

  const needsFraction = action === 'request_add' || action === 'request_reduce'
  if (needsFraction && !isUnitFraction(value.fraction)) {
    throw new InvalidStrategyDefinitionError(
      `el trigger "${action}" requiere una fraction en (0, 1]`,
      value.fraction,
    )
  }
  if (!needsFraction && value.fraction !== undefined) {
    throw new InvalidStrategyDefinitionError(
      `el trigger "${action}" no admite fraction`,
      value.fraction,
    )
  }
}

function assertExecution(value: unknown, where: string): asserts value is OrderExecution {
  if (value !== 'limit' && value !== 'market') {
    throw new InvalidStrategyDefinitionError(`${where} debe ser "limit" o "market"`, value)
  }
}

/**
 * Operandos de una expresión de precio (§1.3/§1.1): los alias de operación
 * solo donde el contexto los permite; el resto deben ser alias registrados de
 * clase `price`/`constant` (los osciladores no forman precios).
 */
function assertPriceOperands(
  expr: PriceExpr,
  classes: SeriesClasses,
  allowed: readonly string[],
  where: string,
): void {
  if (expr.kind === 'binary') {
    assertPriceOperands(expr.left, classes, allowed, where)
    assertPriceOperands(expr.right, classes, allowed, where)
    return
  }

  const id = expr.id
  if (OPERATION_ALIASES.includes(id)) {
    if (!allowed.includes(id)) {
      throw new InvalidStrategyDefinitionError(
        `el alias de operación "${id}" no está disponible en ${where}`,
        id,
      )
    }
    return
  }
  const cls = classes[id]
  if (cls === undefined) {
    throw new InvalidStrategyDefinitionError(
      `el alias "${id}" no está registrado en la estrategia`,
      id,
    )
  }
  if (cls === 'oscillator') {
    throw new InvalidStrategyDefinitionError(
      `los osciladores no forman precios (${id}) en ${where}`,
      id,
    )
  }
}

/**
 * Operandos de operación de una regla (§1.1): prohibidos en `entry.rule` e
 * `invalidation` (se evalúan sin posición → `null`), permitidos en `exitRule`.
 */
function assertRuleOperations(spec: RuleSpec, allowed: readonly string[], where: string): void {
  if (spec.kind === 'condition') {
    assertOperand(spec.a, allowed, where)
    assertOperand(spec.b, allowed, where)
    return
  }
  if (spec.kind === 'not') {
    assertRuleOperations(spec.rule, allowed, where)
    return
  }
  for (const rule of spec.rules) assertRuleOperations(rule, allowed, where)
}

function assertOperand(operand: string, allowed: readonly string[], where: string): void {
  if (OPERATION_ALIASES.includes(operand) && !allowed.includes(operand)) {
    throw new InvalidStrategyDefinitionError(
      `el alias de operación "${operand}" no está disponible en ${where}`,
      operand,
    )
  }
}

function buildIndicator(spec: IndicatorSpec): Indicator {
  switch (spec.kind) {
    case 'sma':
      return new Sma(spec.period)
    case 'ema':
      return new Ema(spec.period)
    case 'rsi':
      return new Rsi(spec.period)
    case 'const':
      return new Constant(spec.value)
  }
}

/** Clase del indicador (§1.3): SMA/EMA sobre precio, RSI oscilador, const. */
function classOfKind(kind: IndicatorSpec['kind']): SeriesClass {
  if (kind === 'rsi') return 'oscillator'
  if (kind === 'const') return 'constant'
  return 'price'
}
