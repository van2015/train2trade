/** Puntos básicos: 1 bps = 0,01 %. */
export const BPS = 10_000

/**
 * Precio desplazado por slippage en bps (compra cara / venta barata: el sesgo
 * es siempre contra el usuario). Fuente única de la fórmula de slippage,
 * compartida por el `ExecutionModel` (relleno real) y el `RiskManager`
 * (estimación previa de costes, §8).
 */
export function withSlippage(price: number, slippageBps: number): number {
  return price * (1 + slippageBps / BPS)
}

/**
 * Coste unitario con comisión incluida (forma multiplicativa, equivalente a
 * `price + feeFor(price, feeBps)`). Lo usa el `RiskManager` para estimar el
 * coste real sin construir un `Fill`.
 */
export function withFee(price: number, feeBps: number): number {
  return price * (1 + feeBps / BPS)
}

/** Comisión en bps sobre el notional de un relleno. */
export function feeFor(notional: number, feeBps: number): number {
  return (notional * feeBps) / BPS
}
