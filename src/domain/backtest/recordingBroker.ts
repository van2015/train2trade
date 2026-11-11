import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { Fill } from '@/domain/execution/fill'
import { Order, OrderSide } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'

/**
 * Decorador de observabilidad (§6 "registro de operaciones", §9): envuelve
 * cualquier `Broker` sin alterar su comportamiento y registra:
 *
 * - `orders`: las órdenes enviadas con su estado final (el `Order` muta en
 *   sitio, así que el registro siempre refleja Filled/Cancelled/Rejected);
 * - `trades`: un `Trade` por cada relleno de venta, construido con el estado
 *   de la posición **previo** a la vela (`entry = avgEntry` anterior), de modo
 *   que `Σ trades.pnl = portfolio.realizedPnl`.
 *
 * Supuesto: como máximo un fill por vela — el `StrategyRunner` mantiene una
 * sola orden en vuelo, por lo que el snapshot previo es válido para ese fill.
 */
export class RecordingBroker implements Broker {
  private readonly inner: Broker
  private readonly account: Account
  private readonly tradeLog: Trade[] = []
  private readonly orderLog: Order[] = []

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
      // Un relleno de venta sin posición previa es imposible: el broker la
      // rechaza antes (long-only), así que no hay registro que construir.
      if (fill.side === OrderSide.Sell && positionBefore !== null) {
        this.tradeLog.push(buildTrade(fill, positionBefore))
      }
    }

    return fills
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
    // Mismo cálculo que el incremento de `realizedPnl` en `Position.applyFill`.
    pnl: (fill.price - positionBefore.avgEntryPrice) * fill.qty - fill.fee,
    fees: fill.fee,
  })
}
