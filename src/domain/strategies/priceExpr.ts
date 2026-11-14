import { DomainError, invalidMessage } from '@/domain/errors'
import { MarketContext } from '@/domain/strategies/marketContext'

export class InvalidPriceExprError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidPriceExprError', invalidMessage('Expresión de precio inválida', reason, raw))
  }
}

/**
 * Expresión de precio sin precios absolutos (decisión del plan): solo series
 * (alias de indicador o de operación) y sus relaciones aritméticas. No hay
 * literales numéricos — donde haría falta un número se declara un indicador
 * constante en la spec (p. ej. `two`, `umbral30`).
 */
export type PriceExpr =
  | { kind: 'series'; id: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: PriceExpr; right: PriceExpr }

/** Alias de serie aceptado por los builders (se convierte en hoja). */
export type PriceSeriesRef = PriceExpr | string

/** Hoja con el alias `id` (no vacío). */
export function series(id: string): PriceExpr {
  return binary('series', id)
}

/** `left + right`. */
export function plus(left: PriceSeriesRef, right: PriceSeriesRef): PriceExpr {
  return { kind: 'binary', op: '+', left: toExpr(left), right: toExpr(right) }
}

/** `left - right`. */
export function minus(left: PriceSeriesRef, right: PriceSeriesRef): PriceExpr {
  return { kind: 'binary', op: '-', left: toExpr(left), right: toExpr(right) }
}

/** `left * right`. */
export function times(left: PriceSeriesRef, right: PriceSeriesRef): PriceExpr {
  return { kind: 'binary', op: '*', left: toExpr(left), right: toExpr(right) }
}

/** `left / right`; la división por cero evalúa a `null` (nunca a no finito). */
export function dividedBy(left: PriceSeriesRef, right: PriceSeriesRef): PriceExpr {
  return { kind: 'binary', op: '/', left: toExpr(left), right: toExpr(right) }
}

/**
 * Representación legible para observabilidad (nombres de señal/trigger):
 * las sub-expresiones binarias van entre paréntesis para no perder la
 * precedencia (`entry - (two * atr)`).
 */
export function formatPriceExpr(expr: PriceExpr): string {
  if (expr.kind === 'series') return expr.id
  return `${wrap(expr.left)} ${expr.op} ${wrap(expr.right)}`
}

function wrap(expr: PriceExpr): string {
  const text = formatPriceExpr(expr)
  return expr.kind === 'binary' ? `(${text})` : text
}

function binary(kind: 'series', id: string): PriceExpr {
  const expr: PriceExpr = { kind, id }
  assertPriceExpr(expr)
  return expr
}

function toExpr(ref: PriceSeriesRef): PriceExpr {
  return typeof ref === 'string' ? series(ref) : ref
}

/**
 * Valida la forma completa (recursiva): hoja con alias no vacío u operador
 * aritmético con ambos hijos válidos. Un número u otro tipo de valor →
 * `InvalidPriceExprError` (un precio no puede ser constante, §decisión 9).
 * Devuelve la expresión para encadenar.
 */
export function assertPriceExpr(value: unknown): PriceExpr {
  if (!isRecord(value)) {
    throw new InvalidPriceExprError('se esperaba una hoja o una operación aritmética', value)
  }

  if (value.kind === 'series') {
    if (typeof value.id !== 'string' || value.id === '') {
      throw new InvalidPriceExprError('la serie requiere un alias no vacío', value.id)
    }
    return value as unknown as PriceExpr
  }

  if (
    value.kind === 'binary' &&
    (value.op === '+' || value.op === '-' || value.op === '*' || value.op === '/')
  ) {
    assertPriceExpr(value.left)
    assertPriceExpr(value.right)
    return value as unknown as PriceExpr
  }

  throw new InvalidPriceExprError(
    'operador desconocido: se admite +, -, * o / entre series',
    typeof value.kind === 'string' ? `${value.kind} ${String(value.op)}` : value.kind,
  )
}

/**
 * Evaluación pura contra el contexto (vela actual): `null` si cualquier hoja
 * está en calentamiento o el resultado no es finito (división por cero). Un
 * alias no registrado propaga `MarketContextError` (error de configuración,
 * igual que `resolveRef`).
 */
export function evaluatePriceExpr(expr: PriceExpr, context: MarketContext): number | null {
  const value = evaluate(expr, context)
  return value !== null && Number.isFinite(value) ? value : null
}

function evaluate(expr: PriceExpr, context: MarketContext): number | null {
  if (expr.kind === 'series') return context.value(expr.id)

  const left = evaluate(expr.left, context)
  if (left === null) return null
  const right = evaluate(expr.right, context)
  if (right === null) return null

  switch (expr.op) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return right === 0 ? null : left / right
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
