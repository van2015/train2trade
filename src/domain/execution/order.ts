import { DomainError, invalidMessage } from '@/domain/errors'

export enum OrderSide {
  /** Compra: abre o aumenta la posición (long-only). */
  Buy = 'buy',
  /** Venta: reduce o cierra la posición. */
  Sell = 'sell',
}

export enum OrderType {
  /** Se rellena con el modelo de ejecución en la siguiente vela disponible. */
  Market = 'market',
  /** Se rellena solo si el mercado alcanza `price`. */
  Limit = 'limit',
}

export enum OrderStatus {
  Pending = 'pending',
  Filled = 'filled',
  Cancelled = 'cancelled',
  Rejected = 'rejected',
}

export interface OrderData {
  /** Identificador único (lo asigna quien crea la orden; determinista en tests). */
  id: string
  side: OrderSide
  type: OrderType
  /** Cantidad del instrumento, finita y > 0. */
  qty: number
  /** Precio objetivo: obligatorio y > 0 en `Limit`; prohibido en `Market`. */
  price?: number | null
  /** Timestamp de creación en ms UTC. */
  createdAt: number
}

export class InvalidOrderError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidOrderError', invalidMessage('Orden inválida', reason, raw))
  }
}

/**
 * Orden de ejecución (long-only): unidad de trabajo del broker (§6). La transición
 * de estado es imperativa (`fill`/`cancel`/`reject`) y solo es válida desde
 * `Pending`; cualquier otra llamada es un bug de integración → `InvalidOrderError`.
 * El relleno en sí (precio, slippage, comisión) es labor del `ExecutionModel` (T2).
 */
export class Order {
  readonly id: string
  readonly side: OrderSide
  readonly type: OrderType
  readonly qty: number
  /** Precio objetivo; `null` en `Market`. */
  readonly price: number | null
  readonly createdAt: number

  private current: OrderStatus
  private reason: string | null

  constructor(data: OrderData) {
    validateOrderData(data)
    const { id, side, type, qty, price, createdAt } = data

    this.id = id
    this.side = side
    this.type = type
    this.qty = qty
    this.price = type === OrderType.Limit ? (price as number) : null
    this.createdAt = createdAt
    this.reason = null
    this.current = OrderStatus.Pending
  }

  get status(): OrderStatus {
    return this.current
  }

  /** Motivo del rechazo; `null` salvo en `Rejected`. */
  get rejectReason(): string | null {
    return this.reason
  }

  /** true ⇔ sigue esperando relleno, cancelación o rechazo. */
  get isPending(): boolean {
    return this.current === OrderStatus.Pending
  }

  /** Relleno confirmado por el `ExecutionModel` (vía broker). */
  fill(): void {
    this.transition(OrderStatus.Filled, 'fill')
  }

  /** Cancelación solicitada antes del relleno. */
  cancel(): void {
    this.transition(OrderStatus.Cancelled, 'cancel')
  }

  /** Rechazo controlado (p. ej. riesgo/capital), con motivo no vacío. */
  reject(reason: string): void {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new InvalidOrderError('reject requiere un motivo no vacío', reason)
    }
    this.transition(OrderStatus.Rejected, 'reject', reason)
  }

  private transition(to: OrderStatus, action: string, rejectReason?: string): void {
    if (this.current !== OrderStatus.Pending) {
      throw new InvalidOrderError(`${action} no es aplicable en "${this.current}"`, action)
    }
    this.current = to
    if (rejectReason !== undefined) this.reason = rejectReason
  }
}

/** Valida el payload de la orden; lanza `InvalidOrderError` en el primer campo inválido. */
function validateOrderData(data: OrderData): void {
  const { id, side, type, qty, price, createdAt } = data

  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidOrderError('el id no puede estar vacío', id)
  }
  if (!Object.values(OrderSide).includes(side)) {
    throw new InvalidOrderError('side debe ser "buy" o "sell"', side)
  }
  if (!Object.values(OrderType).includes(type)) {
    throw new InvalidOrderError('type debe ser "market" o "limit"', type)
  }
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    throw new InvalidOrderError('qty debe ser un número finito > 0', qty)
  }
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new InvalidOrderError('createdAt debe ser un timestamp finito (ms)', createdAt)
  }

  if (type === OrderType.Limit) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new InvalidOrderError('una orden limit requiere un price finito > 0', price ?? null)
    }
  } else if (price !== undefined) {
    throw new InvalidOrderError('una orden de mercado no admite price', price)
  }
}
