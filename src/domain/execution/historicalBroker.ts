import { Candle } from '@/domain/candles/candle'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { ExecutionModel, NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { Fill } from '@/domain/execution/fill'
import { InvalidOrderError, Order, OrderSide } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'

/**
 * Broker de datos históricos (§6): ejecuta las órdenes pendientes con el
 * `ExecutionModel` inyectado cada vez que recibe una vela, aplicando los
 * rellenos a la `Account` inyectada (que mueve efectivo y posición; en la app
 * esa cuenta es un `Portfolio`, pero el broker no lo conoce → sin ciclo
 * `execution ↔ portfolio`).
 *
 * Rechazos **controlados** (orden → `Rejected` con motivo, sin excepción):
 * - compra cuyo coste (precio + comisión) supera el efectivo disponible;
 * - venta sin posición abierta o superior a la posición (long-only).
 *
 * Excepciones (`InvalidOrderError`) solo para errores de integración: enviar
 * una orden no pendiente o cancelar un id desconocido/resuelto.
 * Determinista: misma cuenta + mismas velas + mismo modelo → mismos rellenos.
 */
export class HistoricalBroker implements Broker {
  readonly account: Account
  readonly executionModel: ExecutionModel

  private pending: Order[] = []

  constructor(account: Account, executionModel: ExecutionModel = new NextOpenExecutionModel()) {
    this.account = account
    this.executionModel = executionModel
  }

  submitOrder(order: Order): Order {
    if (!order.isPending) {
      throw new InvalidOrderError(
        `submitOrder solo admite órdenes pending (está "${order.status}")`,
        order.status,
      )
    }
    this.pending.push(order)
    return order
  }

  cancelOrder(orderId: string): void {
    const index = this.pending.findIndex((order) => order.id === orderId)
    if (index < 0) {
      throw new InvalidOrderError(
        'la orden no está pendiente (id desconocido o ya resuelta)',
        orderId,
      )
    }
    const order = this.pending[index]
    if (order === undefined) return
    order.cancel()
    this.pending.splice(index, 1)
  }

  advance(candle: Candle): Fill[] {
    const fills: Fill[] = []

    for (const order of [...this.pending]) {
      const fill = this.executionModel.evaluate(order, candle)
      if (fill === null) continue

      const rejection = this.rejectionReason(order, fill)
      if (rejection !== null) {
        order.reject(rejection)
        this.remove(order)
        continue
      }

      this.account.applyFill(fill)
      order.fill()
      this.remove(order)
      fills.push(fill)
    }

    return fills
  }

  positions(): readonly Position[] {
    const position = this.account.position
    return position === null ? [] : [position]
  }

  pendingOrders(): readonly Order[] {
    return [...this.pending]
  }

  /** Motivo de rechazo controlado; `null` si el relleno es admisible. */
  private rejectionReason(order: Order, fill: Fill): string | null {
    if (order.side === OrderSide.Buy) {
      const cost = fill.price * fill.qty + fill.fee
      return cost > this.account.cash ? 'efectivo insuficiente' : null
    }

    const position = this.account.position
    if (position === null || position.isEmpty) return 'sin posición abierta'
    return fill.qty > position.qty ? 'sin posición suficiente' : null
  }

  private remove(order: Order): void {
    this.pending = this.pending.filter((pending) => pending !== order)
  }
}
