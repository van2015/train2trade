/** `true` si `value` es un objeto no nulo y no array (la forma de un DTO/registro). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `true` si `value` es un número finito (ni `NaN` ni infinito). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** `true` si `value` es un número finito estrictamente positivo. */
export function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}
