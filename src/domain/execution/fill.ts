import { DomainError, invalidMessage } from '@/domain/errors'

export interface FillData {
  /** Orden que produjo el relleno. */
  orderId: string
  /** Precio efectivo de ejecución (con slippage y mejora de límite ya aplicados), finito > 0. */
  price: number
  /** Cantidad rellenada, finita > 0. */
  qty: number
  /** Comisión cobrada en la unidad cotizada; finita >= 0. */
  fee: number
  /** Tiempo de mercado del relleno (ms UTC; la vela que disparó la ejecución). */
  time: number
}

export class InvalidFillError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidFillError', invalidMessage('Relleno inválido', reason, raw))
  }
}

/**
 * Relleno confirmado de una orden: el resultado puro del `ExecutionModel`.
 * No muta la orden (el broker es quien aplica `Order.fill()`), para que el
 * cálculo de precio sea una función pura y testeable por separado.
 */
export class Fill {
  readonly orderId: string
  readonly price: number
  readonly qty: number
  readonly fee: number
  readonly time: number

  constructor(data: FillData) {
    const { orderId, price, qty, fee, time } = data

    if (typeof orderId !== 'string' || orderId.trim() === '') {
      throw new InvalidFillError('el orderId no puede estar vacío', orderId)
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new InvalidFillError('price debe ser un número finito > 0', price)
    }
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
      throw new InvalidFillError('qty debe ser un número finito > 0', qty)
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) {
      throw new InvalidFillError('fee debe ser un número finito >= 0', fee)
    }
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new InvalidFillError('time debe ser un timestamp finito (ms)', time)
    }

    this.orderId = orderId
    this.price = price
    this.qty = qty
    this.fee = fee
    this.time = time
  }
}
