import { isRecord } from '@/domain/guards'
import { isUnitFraction } from '@/domain/numbers'
import { assertPriceExpr } from '@/domain/strategies/priceExpr'
import { InvalidStrategyDefinitionError, OrderExecution } from '@/domain/strategies/strategy'
import { RESERVED_ALIASES, TRIGGER_ACTIONS } from '@/domain/strategies/spec/aliases'
import { RuleSpec, StrategySpec } from '@/domain/strategies/spec/types'

/**
 * Validación de la **forma** de la spec (§1.4): tipos, rangos, reglas
 * limit⇔price, alias no reservados/únicos y reglas de `fraction`. Es lo que
 * usa la persistencia: el repositorio envuelve sus errores en
 * `CorruptedStorageError` (mismo patrón que `Trade.from`).
 *
 * Cualquier problema → `InvalidStrategyDefinitionError` en el primer fallo.
 * La semántica (clases por contexto de operación) la valida `build`.
 */

/** Valida la forma completa de una spec (§1.4). */
export function assertStrategySpec(value: unknown): asserts value is StrategySpec {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('la spec debe ser un objeto', value)
  }

  const { name, version, indicators, entry, exitRule, invalidation } = value

  if (typeof name !== 'string' || name.trim() === '') {
    throw new InvalidStrategyDefinitionError('el name no puede estar vacío', name)
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new InvalidStrategyDefinitionError('la version debe ser un entero >= 1', version)
  }

  assertIndicatorsSpec(indicators)

  if (!isRecord(entry)) {
    throw new InvalidStrategyDefinitionError('entry debe ser un objeto', entry)
  }
  assertEntrySpec(entry)

  assertLevelsSpec(value)
  assertTriggersSpec(value.triggers)

  if (exitRule !== undefined) assertRuleSpec(exitRule)
  if (invalidation !== undefined) assertRuleSpec(invalidation)
}

/** `parseStrategySpec`: alias de `assertStrategySpec` para la persistencia. */
export function parseStrategySpec(value: unknown): StrategySpec {
  assertStrategySpec(value)
  return value
}

/**
 * Valida la forma del árbol (recursiva): hoja con operador y alias no vacíos,
 * `and`/`or` con ≥ 1 hijo, `not` con regla.
 */
export function assertRuleSpec(value: unknown): asserts value is RuleSpec {
  if (!isRecord(value)) {
    throw new InvalidStrategyDefinitionError('se esperaba un nodo de regla', value)
  }

  switch (value.kind) {
    case 'condition': {
      const { op, a, b } = value
      if (
        op !== 'crosses_above' &&
        op !== 'crosses_below' &&
        op !== '>' &&
        op !== '<' &&
        op !== '=='
      ) {
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
    case 'first_since':
      if (value.since === undefined || value.then === undefined) {
        throw new InvalidStrategyDefinitionError(
          '"first_since" requiere las ramas "since" y "then"',
          value,
        )
      }
      assertRuleSpec(value.since)
      assertRuleSpec(value.then)
      return
    default:
      throw new InvalidStrategyDefinitionError('nodo de regla desconocido', value.kind)
  }
}

/** Forma de `indicators`: array con alias únicos/no reservados y kind/period válidos. */
function assertIndicatorsSpec(indicators: unknown): void {
  if (!Array.isArray(indicators)) {
    throw new InvalidStrategyDefinitionError('indicators debe ser un array', indicators)
  }
  const seen = new Set<string>()
  for (const indicator of indicators) assertIndicatorSpec(indicator, seen)
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
  if (kind !== 'sma' && kind !== 'ema' && kind !== 'rsi' && kind !== 'lowestLow') {
    throw new InvalidStrategyDefinitionError(
      'kind de indicador desconocido (sma/ema/rsi/lowestLow/const)',
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

/** Forma de los niveles TP/SL: `price` obligatoria + ejecución conocida (§1.4). */
function assertLevelsSpec(value: Record<string, unknown>): void {
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
}

/** Forma de `triggers`: array con price/action/execution/fraction válidos (§1.4). */
function assertTriggersSpec(triggers: unknown): void {
  if (triggers === undefined) return
  if (!Array.isArray(triggers)) {
    throw new InvalidStrategyDefinitionError('triggers debe ser un array', triggers)
  }
  for (const trigger of triggers) assertTriggerSpec(trigger)
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

function assertAlias(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value === '') {
    throw new InvalidStrategyDefinitionError(
      `el operando "${field}" debe ser un alias no vacío`,
      value,
    )
  }
}
