import { DomainError, invalidMessage } from '@/domain/errors'

/** Dónde cae un precio respecto a la vela. El cuerpo es cerrado: `high` solo es `UpperWick` si no toca el cuerpo. */
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

/** Relación de un valor respecto a un nivel; el empate es estado propio (`At`). */
export enum LevelPosition {
  Above = 'above',
  At = 'at',
  Below = 'below',
}

export class InvalidPriceError extends DomainError {
  constructor(reason: string, raw: unknown) {
    super('InvalidPriceError', invalidMessage('Precio inválido', reason, raw))
  }
}

/** Valida que `price` sea finito; sin esto `NaN` compararía `false` contra todo en silencio. */
export function assertFinitePrice(price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new InvalidPriceError('se esperaba un número finito', price)
  }
  return price
}
