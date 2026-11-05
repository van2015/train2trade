/**
 * Dónde cae un precio respecto a la vela (rango exterior `[low, high]` y cuerpo).
 * El cuerpo es cerrado: `high` solo es `UpperWick` si el cuerpo no lo toca.
 */
export enum PricePosition {
  /** price > high */
  Above = 'above',
  /** bodyTop < price <= high */
  UpperWick = 'upper_wick',
  /** bodyBottom <= price <= bodyTop */
  Body = 'body',
  /** low <= price < bodyBottom */
  LowerWick = 'lower_wick',
  /** price < low */
  Below = 'below',
}

/**
 * Relación de un valor (cierre, apertura…) respecto a un nivel de precio.
 * El empate es estado propio (`At`): cerrar en el nivel no es ruptura.
 */
export enum LevelPosition {
  Above = 'above',
  /** Empate: el valor coincide exactamente con el nivel. */
  At = 'at',
  Below = 'below',
}

export class InvalidPriceError extends Error {
  constructor(reason: string, raw: unknown) {
    super(`Precio inválido: ${reason} (recibido: ${formatValue(raw)})`)
    this.name = 'InvalidPriceError'
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'un array'
  if (typeof value === 'object') return 'un objeto'
  return String(value)
}

/**
 * Valida que `price` sea un número finito y lo devuelve. Sin esta validación,
 * `NaN` compararía `false` contra todo y caería en un estado incorrecto en
 * silencio.
 */
export function assertFinitePrice(price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new InvalidPriceError('se esperaba un número finito', price)
  }
  return price
}
