import { Fill } from '@/domain/execution/fill'
import { Order, OrderSide } from '@/domain/execution/order'

/**
 * Textos de log de ejecución (§12D), en español y listos para mostrar.
 * Fuente única compartida por el replay y el test-forward: ambos registran
 * órdenes y rellenos con el mismo formato, así que el texto no se duplica.
 */

/** Cantidad/precio legibles: 8 decimales sin ceros sobrantes (texto de log). */
export function formatAmount(value: number): string {
  return String(Number(value.toFixed(8)))
}

/** Verbo según el lado de la orden: `comprar` (Buy) / `vender` (Sell). */
function verb(side: OrderSide): string {
  return side === OrderSide.Buy ? 'comprar' : 'vender'
}

/** `"Orden enviada: comprar 5 (o1)"` (órdenes del runner y manuales). */
export function formatOrderSent(order: Order): string {
  return `Orden enviada: ${verb(order.side)} ${formatAmount(order.qty)} (${order.id})`
}

/** `"Orden manual enviada: comprar 5 (m1)"` (las manuales no emiten evento). */
export function formatManualOrderSent(order: Order): string {
  return `Orden manual enviada: ${verb(order.side)} ${formatAmount(order.qty)} (${order.id})`
}

/** `"Compra rellenada: 5 @ 100 (o1)"`; con `manual` → `"Compra manual rellenada: …"`. */
export function formatFill(fill: Fill, manual = false): string {
  const subject = `${fill.side === OrderSide.Buy ? 'Compra' : 'Venta'}${manual ? ' manual' : ''} rellenada`
  return `${subject}: ${formatAmount(fill.qty)} @ ${formatAmount(fill.price)} (${fill.orderId})`
}

/** `"Orden rechazada (o1): efectivo insuficiente"` (+ variante manual). */
export function formatOrderRejected(orderId: string, reason: string, manual = false): string {
  const subject = manual ? 'Orden manual rechazada' : 'Orden rechazada'
  return `${subject} (${orderId}): ${reason}`
}

/** `"Orden cancelada (o1)"`. */
export function formatOrderCancelled(orderId: string): string {
  return `Orden cancelada (${orderId})`
}
