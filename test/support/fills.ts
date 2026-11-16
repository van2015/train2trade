import { Fill } from '@/domain/execution/fill'
import { OrderSide } from '@/domain/execution/order'

/**
 * Tiempos por defecto de los fixtures (idénticos en todos los ficheros):
 * `t0` y `t1 = t0 + 1 min`. Los tests que necesiten otro tiempo lo pasan.
 */
const t0 = 1_700_000_000_000
const t1 = t0 + 60_000

/** Relleno de compra para fixtures (`orderId` estable: `b`). */
export function buy(qty: number, price: number, time = t0, fee = 0): Fill {
  return new Fill({ orderId: 'b', side: OrderSide.Buy, price, qty, fee, time })
}

/** Relleno de venta para fixtures (`orderId` estable: `s`). */
export function sell(qty: number, price: number, time = t1, fee = 0): Fill {
  return new Fill({ orderId: 's', side: OrderSide.Sell, price, qty, fee, time })
}
