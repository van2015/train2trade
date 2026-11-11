import { Candle } from '@/domain/candles/candle'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Fill } from '@/domain/execution/fill'
import { InvalidOrderError, Order, OrderType } from '@/domain/execution/order'

export interface ExecutionModelConfig {
  /** Desviación del precio de mercado en puntos básicos (0.01%); >= 0. Por defecto 0. */
  slippageBps?: number
  /** Comisión sobre el valor del relleno en puntos básicos; >= 0. Por defecto 0. */
  feeBps?: number
}

export class InvalidExecutionModelError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('InvalidExecutionModelError', invalidMessage('Modelo de ejecución inválido', reason, raw))
  }
}

/**
 * Convierte una orden en un `Fill` dados los datos de mercado (§6).
 * Contrato anti look-ahead: `evaluate` solo recibe la vela con la que se evalúa
 * (la posterior a la decisión) y no tiene acceso a ninguna otra.
 */
export interface ExecutionModel {
  /** Relleno de `order` con `candle`; `null` si la vela no alcanza la orden. */
  evaluate(order: Order, candle: Candle): Fill | null
}

const BPS = 10_000

/**
 * Ejecución a la apertura de la siguiente vela (decisión cerrada en Fase 3):
 *
 * - **Market**: rellena siempre al `open` desplazado por `slippageBps`
 *   (compra cara, venta barata: el sesgo es siempre contra el usuario).
 * - **Limit**: sin slippage. Si el `open` ya supera el límite rellena al `open`
 *   (mejor precio que el pedido); si no, rellena al límite cuando la vela lo
 *   toca (`open <= límite` en compra, `high >= límite` en venta); si no → `null`.
 * - **fee**: `price * qty * feeBps / 10_000`.
 *
 * Determinista y puro: mismas entradas → mismos resultados (reproducibilidad, §12C).
 */
export class NextOpenExecutionModel implements ExecutionModel {
  readonly slippageBps: number
  readonly feeBps: number

  constructor(config: ExecutionModelConfig = {}) {
    const { slippageBps = 0, feeBps = 0 } = config
    if (typeof slippageBps !== 'number' || !Number.isFinite(slippageBps) || slippageBps < 0) {
      throw new InvalidExecutionModelError(
        'slippageBps debe ser un número finito >= 0',
        slippageBps,
      )
    }
    if (typeof feeBps !== 'number' || !Number.isFinite(feeBps) || feeBps < 0) {
      throw new InvalidExecutionModelError('feeBps debe ser un número finito >= 0', feeBps)
    }
    this.slippageBps = slippageBps
    this.feeBps = feeBps
  }

  evaluate(order: Order, candle: Candle): Fill | null {
    if (!order.isPending) {
      throw new InvalidOrderError('evaluate solo admite órdenes pendientes', order.status)
    }

    const price =
      order.type === OrderType.Market
        ? this.marketPrice(order, candle)
        : this.limitPrice(order, candle)
    if (price === null) return null

    return new Fill({
      orderId: order.id,
      price,
      qty: order.qty,
      fee: (price * order.qty * this.feeBps) / BPS,
      time: candle.time,
    })
  }

  private marketPrice(order: Order, candle: Candle): number {
    const factor = 1 + (order.side === 'buy' ? this.slippageBps : -this.slippageBps) / BPS
    return candle.open * factor
  }

  private limitPrice(order: Order, candle: Candle): number | null {
    const limit = order.price
    if (limit === null) return null

    if (order.side === 'buy') {
      if (candle.open <= limit) return candle.open
      return candle.low <= limit ? limit : null
    }
    if (candle.open >= limit) return candle.open
    return candle.high >= limit ? limit : null
  }
}
