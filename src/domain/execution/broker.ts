import { Candle } from '@/domain/candles/candle'
import { Fill } from '@/domain/execution/fill'
import { Order } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'

/**
 * Intermediario entre las decisiones del trading engine y el mercado (§6).
 * El motor no conoce la implementación: `HistoricalBroker` (Fase 3) executa
 * sobre datos históricos; más adelante conviven `PaperTradingBroker` y
 * `LiveBroker` sin cambiar a los consumidores (§14).
 *
 * - `submitOrder`/`cancelOrder`: gestión de órdenes.
 * - `advance(candle)`: alimentación de mercado; devuelve los rellenos de esa
 *   vela (órdenes decididas con anterioridad → sin look-ahead).
 * - `positions`/`pendingOrders`: consulta de estado.
 */
export interface Broker {
  /** Registra una orden `Pending` y la devuelve. Una orden ya resuelta → error. */
  submitOrder(order: Order): Order
  /** Cancela una orden pendiente por id; id desconocido o ya resuelta → error. */
  cancelOrder(orderId: string): void
  /** Evalúa las órdenes pendientes contra `candle` y aplica los rellenos. */
  advance(candle: Candle): Fill[]
  /** Posiciones abiertas (long-only: 0 ó 1). */
  positions(): readonly Position[]
  /** Órdenes pendientes de relleno o cancelación. */
  pendingOrders(): readonly Order[]
}
