import { evaluatePriceExpr } from '@/domain/strategies/priceExpr'
import { Strategy, StrategyAction, StrategyDecision } from '@/domain/strategies/strategy'
import { Candle } from '@/domain/candles/candle'
import { MarketContext } from '@/domain/strategies/marketContext'

/**
 * Puntos de confirmación de entrada (§2.1/§2.2): índices de las velas donde
 * `entry.rule` dispararía con la instancia **cerrada**, sin veto y con el
 * precio resuelto (si la entrada es `limit`). Barrido puro estadoless con
 * contexto por prefijo (`candles[0..i]`): no rastrea posición — es la
 * **aproximación** que usa la sesión para elegir destinos de `jump()`; las
 * pausas reales las decide la sesión con el estado vivo (los puntos reales
 * siempre están contenidos en esta lista).
 *
 * O(n²) por reconstruir el contexto en cada prefijo; aceptable con
 * `MAX_CANDLES = 1000` (riesgo §, follow-up: cálculo incremental).
 */
export function confirmationPoints(
  strategy: Strategy,
  candles: readonly Candle[],
): readonly number[] {
  const points: number[] = []
  for (let index = 0; index < candles.length; index += 1) {
    const context = strategy.buildContext(candles.slice(0, index + 1))
    if (entryConfirmation(strategy, context) !== null) points.push(index)
  }
  return points
}

/**
 * Decisión de entrada que `Strategy.evaluate` devolvería con la instancia
 * cerrada en `context` (veto incluido): `null` si `entry.rule` no dispara o
 * el precio `limit` no resuelve. Fuente única del barrido de arriba.
 */
function entryConfirmation(strategy: Strategy, context: MarketContext): StrategyDecision | null {
  // Sin posición → niveles efectivos todos null (misma materialización que
  // `Strategy.evaluate`: reglas y veto nunca ven entry/sl/tp aquí).
  const ctx = context.withLevels({ entry: null, sl: null, tp: null })

  if (strategy.invalidationRule !== null && strategy.invalidationRule.evaluate(ctx)) return null

  for (const signal of strategy.signals) {
    if (signal.action !== StrategyAction.RequestEntry) continue
    if (!signal.rule.evaluate(ctx)) continue

    let price: number | null = null
    if (signal.config.price !== undefined) {
      price = evaluatePriceExpr(signal.config.price, ctx)
      if (price === null) continue // precio sin resolver → la señal se descarta
    }
    return { action: StrategyAction.RequestEntry, fraction: null, price, reason: signal.name }
  }
  return null
}
