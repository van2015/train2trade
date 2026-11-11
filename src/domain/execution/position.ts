import { DomainError, invalidMessage } from '@/domain/errors'
import { Fill } from '@/domain/execution/fill'
import { OrderSide } from '@/domain/execution/order'

export class InvalidPositionError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidPositionError', invalidMessage('Posición inválida', reason, raw))
  }
}

/**
 * Posición larga (long-only) de un instrumento: qty, coste unitario, P&L
 * realizado y comisiones acumuladas (§6). Objeto con estado y comportamiento:
 * muta con los rellenos que le entrega el broker.
 *
 * Contabilidad (decisión de Fase 3):
 * - `avgEntryPrice` es el **coste unitario incluyendo comisiones**: cada compra
 *   lo promedia ponderadamente con `price * qty + fee`. Así `unrealizedPnl` y
 *   `realizedPnl` salen ya netos de comisiones sin contarlas dos veces.
 * - `realizedPnl` solo crece al vender (parcial o total), descontando la fee de
 *   la venta. Una venta sobre posición vacía o superior a la abierta → error.
 * - Una posición cerrada (`isEmpty`) es un objeto agotado: la siguiente entrada
 *   crea otra (el broker decide).
 */
export class Position {
  readonly openedAt: number

  private qtyValue: number
  private entryPrice: number
  private realized: number
  private fees: number

  private constructor(fill: Fill) {
    this.qtyValue = fill.qty
    this.entryPrice = (fill.price * fill.qty + fill.fee) / fill.qty
    this.realized = 0
    this.fees = fill.fee
    this.openedAt = fill.time
  }

  /** Abre la posición con el primer relleno de compra. */
  static from(fill: Fill): Position {
    if (fill.side !== OrderSide.Buy) {
      throw new InvalidPositionError('una posición se abre con un relleno de compra', fill.side)
    }
    return new Position(fill)
  }

  /** Cantidad abierta; 0 tras el cierre total. */
  get qty(): number {
    return this.qtyValue
  }

  /** Coste unitario medio de entrada, comisiones incluidas. */
  get avgEntryPrice(): number {
    return this.entryPrice
  }

  /** P&L realizado y ya cobrado (neto de fees de entrada y salida). */
  get realizedPnl(): number {
    return this.realized
  }

  /** Comisiones totales pagadas por esta posición (entrada + salidas). */
  get feesPaid(): number {
    return this.fees
  }

  get isOpen(): boolean {
    return this.qtyValue > 0
  }

  get isEmpty(): boolean {
    return this.qtyValue <= 0
  }

  /**
   * Aplica un relleno: compra → promedio ponderado del coste; venta → realiza
   * P&L de la cantidad vendida y reduce `qty`. Lanza `InvalidPositionError`
   * si la posición está cerrada o la venta supera lo abierto (la orden no se
   * rellenaría en un broker correcto; esto protege contra bugs de integración).
   */
  applyFill(fill: Fill): void {
    if (this.isEmpty) {
      throw new InvalidPositionError('la posición está cerrada; abre una nueva', fill.orderId)
    }

    if (fill.side === OrderSide.Buy) {
      const totalCost = this.entryPrice * this.qtyValue + fill.price * fill.qty + fill.fee
      this.qtyValue += fill.qty
      this.entryPrice = totalCost / this.qtyValue
      this.fees += fill.fee
      return
    }

    if (fill.qty > this.qtyValue) {
      throw new InvalidPositionError(
        `la venta (${fill.qty}) supera la posición abierta (${this.qtyValue})`,
        fill.qty,
      )
    }

    this.realized += (fill.price - this.entryPrice) * fill.qty - fill.fee
    this.fees += fill.fee
    this.qtyValue -= fill.qty
  }

  /** Valor de mercado de la posición abierta al precio dado. */
  marketValue(price: number): number {
    return this.qtyValue * price
  }

  /** P&L por marcar (neto de comisiones de entrada) al precio dado. */
  unrealizedPnl(price: number): number {
    return (price - this.entryPrice) * this.qtyValue
  }
}
