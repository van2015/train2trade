import { Constant } from '@/domain/indicators/constant'
import { Ema } from '@/domain/indicators/ema'
import { Indicator } from '@/domain/indicators/indicator'
import { LowestLow } from '@/domain/indicators/lowestLow'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'
import { PriceExpr } from '@/domain/strategies/priceExpr'
import {
  All,
  Any,
  CrossesAbove,
  CrossesBelow,
  Equals,
  FirstSince,
  Greater,
  Lower,
  Not,
  Rule,
} from '@/domain/strategies/rules'
import {
  InvalidStrategyDefinitionError,
  PriceLevel,
  Signal,
  SignalAction,
  Strategy,
  StrategyAction,
  Trigger,
} from '@/domain/strategies/strategy'
import {
  BUILTIN_CLASSES,
  classOfKind,
  compatibleClasses,
  operationAliases,
  OPERATION_ALIASES,
  TRIGGER_ACTIONS,
} from '@/domain/strategies/spec/aliases'
import { assertRuleSpec, parseStrategySpec } from '@/domain/strategies/spec/validate'
import {
  IndicatorSpec,
  RuleSpec,
  SeriesClass,
  SeriesClasses,
  StrategySpec,
} from '@/domain/strategies/spec/types'

/**
 * Construcción de la `Strategy` del dominio a partir de una `StrategySpec`
 * validada: aquí vive la **semántica** (alias registrados, clases por contexto
 * de operación — decisión 12 — y reglas de operandos de operación — §1.1),
 * no la forma (eso es `validate`).
 */

/**
 * Construye la `Strategy` del dominio (§1.4): valida la semántica de la spec
 * (alias registrados, clases por contexto de operación) y ensambla indicadores,
 * señales (entry + exitRule), niveles TP/SL, triggers y veto.
 */
export function buildStrategy(spec: StrategySpec): Strategy {
  const parsed = parseStrategySpec(spec)

  // 1. Indicadores → instancia + mapa de clases.
  const { indicators, classes } = buildIndicators(parsed)
  const allClasses: SeriesClasses = { ...BUILTIN_CLASSES, ...classes }

  // 2-3. Señales: entry (limit adjunta price; market no) + exitRule (market).
  const signals = buildSignals(parsed, classes, allClasses)

  // 4. Niveles TP/SL: `entry` disponible, `sl`/`tp` sin auto-referencia (§1.1).
  const { takeProfit, stopLoss } = buildLevels(parsed, allClasses)

  // 5. Triggers: los tres alias de operación disponibles (§1.1).
  const triggers = buildTriggers(parsed, allClasses)

  // 6. Veto: sin alias de operación (mismo criterio que entry.rule).
  const invalidationRule = buildInvalidation(parsed, classes)

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

/** 1. Indicadores → instancia por alias + su clase de serie. */
function buildIndicators(spec: StrategySpec): {
  indicators: Record<string, Indicator>
  classes: Record<string, SeriesClass>
} {
  const indicators: Record<string, Indicator> = {}
  const classes: Record<string, SeriesClass> = {}
  for (const indicator of spec.indicators) {
    indicators[indicator.alias] = buildIndicator(indicator)
    classes[indicator.alias] = classOfKind(indicator.kind)
  }
  return { indicators, classes }
}

/** 2-3. Entrada + salida por regla: operandos de operación según contexto (§1.1) + clases (§1.2). */
function buildSignals(
  spec: StrategySpec,
  classes: SeriesClasses,
  allClasses: SeriesClasses,
): Signal[] {
  assertRuleOperations(spec.entry.rule, operationAliases('entry.rule'), 'entry.rule')
  const entryRule = buildRule(spec.entry.rule, classes)

  const entryConfig: { price?: PriceExpr } = {}
  if (spec.entry.execution === 'limit') {
    assertPriceOperands(
      spec.entry.price,
      allClasses,
      operationAliases('entry.price'),
      'entry.price',
    )
    entryConfig.price = spec.entry.price
  }
  const signals: Signal[] = [new Signal(StrategyAction.RequestEntry, entryRule, entryConfig)]

  if (spec.exitRule !== undefined) {
    assertRuleOperations(spec.exitRule, operationAliases('exitRule'), 'exitRule')
    signals.push(new Signal(StrategyAction.RequestExit, buildRule(spec.exitRule, classes)))
  }
  return signals
}

/** 4. Take-profit/stop-loss declarados, con sus operandos validados por contexto. */
function buildLevels(
  spec: StrategySpec,
  allClasses: SeriesClasses,
): { takeProfit?: PriceLevel; stopLoss?: PriceLevel } {
  let takeProfit: PriceLevel | undefined
  if (spec.takeProfit !== undefined) {
    assertPriceOperands(
      spec.takeProfit.price,
      allClasses,
      operationAliases('takeProfit'),
      'takeProfit.price',
    )
    takeProfit = spec.takeProfit
  }
  let stopLoss: PriceLevel | undefined
  if (spec.stopLoss !== undefined) {
    assertPriceOperands(
      spec.stopLoss.price,
      allClasses,
      operationAliases('stopLoss'),
      'stopLoss.price',
    )
    stopLoss = spec.stopLoss
  }
  return { takeProfit, stopLoss }
}

/** 5. Disparadores por toque de precio (acción + ejecución + fracción). */
function buildTriggers(spec: StrategySpec, allClasses: SeriesClasses): Trigger[] | undefined {
  return spec.triggers?.map((trigger) => {
    assertPriceOperands(trigger.price, allClasses, operationAliases('trigger'), 'trigger.price')
    return new Trigger({
      price: trigger.price,
      action: TRIGGER_ACTIONS[trigger.action],
      execution: trigger.execution,
      fraction: trigger.fraction,
    })
  })
}

/** 6. Regla de veto (mismo criterio de operandos que `entry.rule`). */
function buildInvalidation(spec: StrategySpec, classes: SeriesClasses): Rule | undefined {
  if (spec.invalidation === undefined) return undefined
  assertRuleOperations(spec.invalidation, operationAliases('invalidation'), 'invalidation')
  return buildRule(spec.invalidation, classes)
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
    case 'first_since':
      return new FirstSince(toRule(spec.since, classes), toRule(spec.then, classes))
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
    case '==':
      return new Equals(spec.a, spec.b)
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

export function buildIndicator(spec: IndicatorSpec): Indicator {
  switch (spec.kind) {
    case 'sma':
      return new Sma(spec.period)
    case 'ema':
      return new Ema(spec.period)
    case 'rsi':
      return new Rsi(spec.period)
    case 'lowestLow':
      return new LowestLow(spec.period)
    case 'const':
      return new Constant(spec.value)
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
  if (spec.kind === 'first_since') {
    // Ambas ramas heredan la restricción del contexto (p. ej. sin alias de
    // operación en `entry.rule`): el nodo no es una valla para colar `entry`.
    assertRuleOperations(spec.since, allowed, where)
    assertRuleOperations(spec.then, allowed, where)
    return
  }
  // and / or (el resto de kinds ya está cubierto: si no, TS falla aquí).
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
