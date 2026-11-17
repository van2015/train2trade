import { describe, expect, it } from 'vitest'
import { Fill } from '@/domain/execution/fill'
import { Order, OrderSide, OrderType } from '@/domain/execution/order'
import {
  formatFill,
  formatOrderCancelled,
  formatOrderRejected,
  formatOrderSent,
} from '@/domain/trading/logFormat'

function order(side: OrderSide, qty = 5, id = 'o1'): Order {
  return new Order({ id, side, type: OrderType.Market, qty, createdAt: 0 })
}

function fill(side: OrderSide, qty = 5, price = 100, id = 'o1'): Fill {
  return new Fill({ orderId: id, side, price, qty, fee: 0, time: 0 })
}

/**
 * El contrato de este módulo ES el texto (fuente única §12D para replay y
 * test-forward), así que los tests afirman la cadena completa, ambos lados.
 */
describe('logFormat (§12D)', () => {
  it('formatOrderSent → "Orden enviada: <verbo> <qty> (<id>)"', () => {
    expect(formatOrderSent(order(OrderSide.Buy))).toBe('Orden enviada: comprar 5 (o1)')
    expect(formatOrderSent(order(OrderSide.Sell, 2, 'o2'))).toBe('Orden enviada: vender 2 (o2)')
  })

  it('formatFill → "Compra/Venta rellenada: qty @ price (id)" y variante manual', () => {
    expect(formatFill(fill(OrderSide.Buy))).toBe('Compra rellenada: 5 @ 100 (o1)')
    expect(formatFill(fill(OrderSide.Sell, 2, 50, 'o2'))).toBe('Venta rellenada: 2 @ 50 (o2)')
    expect(formatFill(fill(OrderSide.Buy), true)).toBe('Compra manual rellenada: 5 @ 100 (o1)')
  })

  it('formatOrderRejected → "Orden rechazada (id): motivo" y variante manual', () => {
    expect(formatOrderRejected('o1', 'sin efectivo')).toBe('Orden rechazada (o1): sin efectivo')
    expect(formatOrderRejected('m1', 'sin efectivo', true)).toBe(
      'Orden manual rechazada (m1): sin efectivo',
    )
  })

  it('formatOrderCancelled → "Orden cancelada (id)"', () => {
    expect(formatOrderCancelled('o1')).toBe('Orden cancelada (o1)')
  })
})
