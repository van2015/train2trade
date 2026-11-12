import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { Fill } from '@/domain/execution/fill'
import { InvalidOrderError, Order, OrderSide } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'

/**
 * Decorador de observabilidad (§6 "registro de operaciones", §9): envuelve
 * cualquier `Broker` sin alterar su comportamiento y registra:
 *
 * - `orders`: las órdenes enviadas con su estado final (el `Order` muta en
 *   sitio, así que el registro siempre refleja Filled/Cancelled/Rejected);
 * - `trades`: un `Trade` por cada relleno de venta, construido con el estado
 *   de la posición **previo** a la vela (`entry = avgEntry` anterior), de modo
 *   que `Σ trades.pnl = portfolio.realizedPnl`;
 * - `fills`: los rellenos aplicados en orden (precio/cantidad), payload de
 *   observabilidad (§12D) que consume el log del replay (Fase 5).
 *
 * Supuesto: como máximo un fill por vela — el `StrategyRunner` mantiene una
 * sola orden en vuelo, por lo que el snapshot previo es válido para ese fill.
 */
export class RecordingBroker implements Broker {
  private readonly inner: Broker
  private readonly account: Account
  private readonly tradeLog: Trade[] = []
  private readonly orderLog: Order[] = []
  private readonly fillLog: Fill[] = []

  constructor(inner: Broker, account: Account) {
    this.inner = inner
    this.account = account
  }

  /** Un registro por cierre (parcial o total), en orden. */
  get trades(): readonly Trade[] {
    return [...this.tradeLog]
  }

  /** Órdenes enviadas, con su estado final. */
  get orders(): readonly Order[] {
    return [...this.orderLog]
  }

  /** Rellenos aplicados, en orden (payload de fill, §12D: observabilidad vía decorador). */
  get fills(): readonly Fill[] {
    return [...this.fillLog]
  }

  submitOrder(order: Order): Order {
    const submitted = this.inner.submitOrder(order)
    this.orderLog.push(submitted)
    return submitted
  }

  cancelOrder(orderId: string): void {
    this.inner.cancelOrder(orderId)
  }

  advance(candle: Candle): Fill[] {
    const positionBefore = this.account.position
    const fills = this.inner.advance(candle)

    for (const fill of fills) {
      this.recordFill(fill, positionBefore)
    }

    return fills
  }

  /**
   * Resuelve una orden **fuera** del ciclo de velas: aplica el relleno a la
   * cuenta y, si es venta, construye el `Trade` con el snapshot de posición
   * previo — misma semántica que `advance`. Uso previsto: el cierre opcional
   * al final de un backtest (Fase 6), donde no hay vela siguiente.
   *
   * La orden debe haberse enviado antes con `submitOrder` (misma vida que las
   * del runner) y estar pendiente; `fill.orderId` debe coincidir. Cualquier
   * incumplimiento → `InvalidOrderError` sin mutar nada.
   */
  submitExternalFill(order: Order, fill: Fill): void {
    if (fill.orderId !== order.id) {
      throw new InvalidOrderError('el fill no corresponde a la orden', fill.orderId)
    }
    if (!this.orderLog.includes(order)) {
      throw new InvalidOrderError(
        'la orden debe enviarse con submitOrder antes de resolverla',
        order.id,
      )
    }
    if (!order.isPending) {
      throw new InvalidOrderError(
        `solo se admite una orden pendiente (está "${order.status}")`,
        order.status,
      )
    }

    const positionBefore = this.account.position
    this.account.applyFill(fill)
    order.fill()
    this.recordFill(fill, positionBefore)
  }

  /** Registro común de un relleno aplicado (fill + trade de venta con el snapshot previo). */
  private recordFill(fill: Fill, positionBefore: Position | null): void {
    this.fillLog.push(fill)
    // Un relleno de venta sin posición previa es imposible: el broker la
    // rechaza antes (long-only), así que no hay registro que construir.
    if (fill.side === OrderSide.Sell && positionBefore !== null) {
      this.tradeLog.push(buildTrade(fill, positionBefore))
    }
  }

  positions(): readonly Position[] {
    return this.inner.positions()
  }

  pendingOrders(): readonly Order[] {
    return this.inner.pendingOrders()
  }
}

function buildTrade(fill: Fill, positionBefore: Position): Trade {
  return new Trade({
    entryTime: positionBefore.openedAt,
    entryPrice: positionBefore.avgEntryPrice,
    exitTime: fill.time,
    exitPrice: fill.price,
    qty: fill.qty,
    // Misma fórmula que `Position.applyFill` (fuente única en el dominio).
    pnl: positionBefore.realizedPnlFor(fill),
    fees: fill.fee,
  })
}
