/**
 * Errores del dominio: mensajes compartidos y base común.
 *
 * - `formatValue` formatea un valor desconocido para mostrarlo en un mensaje.
 * - `invalidMessage` construye el patrón estándar de validación.
 * - `DomainError` fija `this.name` a la clase concreta: los errores se
 *   identifican por `name` (convención del proyecto), no solo por `instanceof`.
 */

/** Formatea un valor desconocido para mostrarlo en un mensaje de error. */
export function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'un array'
  if (typeof value === 'object') return 'un objeto'
  return String(value)
}

/** Mensaje estándar de validación: `${prefix}: ${reason} (recibido: ${formatValue(raw)})`. */
export function invalidMessage(prefix: string, reason: string, raw: unknown): string {
  return `${prefix}: ${reason} (recibido: ${formatValue(raw)})`
}

/** Base de los errores de dominio: fija `this.name` y admite `cause` (ES2022). */
export abstract class DomainError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = name
  }
}
