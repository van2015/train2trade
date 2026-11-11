import { Candle } from '@/domain/candles/candle'
import { Broker } from '@/domain/execution/broker'
import { Order, OrderSide, OrderType } from '@/domain/execution/order'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskManager } from '@/domain/portfolio/riskManager'
import { MarketContext } from '@/domain/strategies/marketContext'
import { Strategy, StrategyAction, StrategyDecision } from '@/domain/strategies/strategy'
import { StrategyEvent, StrategyInstance } from '@/domain/strategies/strategyInstance'
import { MarketClock } from '@/domain/time/marketClock'

/** Eventos del ciclo: los de dominio de la instancia + los de la ejecución (§12D). */
export type ExecutionEvent =
  StrategyEvent | 'OrderSubmitted' | 'OrderFilled' | 'OrderRejected' | 'OrderCancelled'

/** Propósito de la orden en vuelo: determina qué hace la instancia al rellenar. */
type OrderKind = 'entry' | 'exit' | 'adjust'

/**
 * Integra la estrategia con la ejecución simulada (Fase 3): por cada vela
 * recibe los datos, actualiza la instancia y mueve órdenes a través del broker.
 * No conoce backtest ni replay (§14) ni React: entrada de velas, salida de
 * eventos de dominio.
 *
 * **Orden anti look-ahead (invariante central):**
 * 1. `broker.advance(vela)` — rellena órdenes decididas en velas anteriores.
 * 2. `strategy.evaluate(...)` — decisión con el cierre de la vela actual.
 * 3. Envío de la orden — solo podrá rellenar en la vela N+1 o después.
 *
 * Reglas de una orden en vuelo: como mucho **una**; las señales que llegan con
 * orden pendiente son refresh (se conserva, sin duplicar). La invalidación
 * cancela la orden de entrada (o de ajuste) pero nunca la de salida: cerrar
 * siempre es admisible. Un rechazo del broker emite `OrderRejected` y deja la
 * instancia como estaba; con la señal viva se reenvía en la misma vela.
 *
 * **Tiempo (§12A):** `onCandle` avanza un `MarketClock` (inyectado por el
 * composition root o interno) como **única fuente** del invariante "tiempo
 * estrictamente creciente"; el runner no reimplementa la regla. La validación
 * ocurre antes de mutar nada: una llamada inválida no avanza el reloj ni
 * toca el estado.
 *
 * Tamaños: entrada → `risk.entryQty`; add → `risk.addQty` con la fracción de
 * la señal; reduce → fracción de la posición; exit → posición completa.
 * Si el riesgo no admite la operación, no se confirma ni se envía nada.
 */
export class StrategyRunner {
  readonly strategy: Strategy
  readonly instance: StrategyInstance
  readonly broker: Broker
  readonly portfolio: Portfolio
  readonly risk: RiskManager
  /** Tiempo de simulación del runner: avanza con cada vela aceptada. */
  readonly clock: MarketClock

  private pendingOrder: Order | null = null
  private pendingKind: OrderKind | null = null
  private orderSeq = 0

  constructor(
    strategy: Strategy,
    broker: Broker,
    portfolio: Portfolio,
    risk: RiskManager = new RiskManager(),
    clock: MarketClock = new MarketClock(),
  ) {
    this.strategy = strategy
    this.instance = new StrategyInstance(strategy)
    this.broker = broker
    this.portfolio = portfolio
    this.risk = risk
    this.clock = clock
  }

  /**
   * Procesa la vela visible (velas ascendentes desde el inicio) y devuelve los
   * eventos. Si el tiempo no progresa estrictamente → `MarketClockError`.
   */
  onCandle(candles: readonly Candle[]): ExecutionEvent[] {
    // 1. Contexto primero: valida las velas antes de mutar nada.
    const context = this.strategy.buildContext(candles)
    const candle = context.current
    // 2. Tiempo: progresión estricta vía MarketClock (la regla no se duplica).
    this.clock.advanceTo(candle.time)

    const events: ExecutionEvent[] = []

    // 3. Avance de mercado: rellena órdenes decididas antes de esta vela.
    for (const fill of this.broker.advance(candle)) {
      if (this.pendingOrder !== null && fill.orderId === this.pendingOrder.id) {
        const kind = this.pendingKind
        this.pendingOrder = null
        this.pendingKind = null
        if (kind === 'entry' || kind === 'exit') {
          const transition = this.instance.onFill()
          if (transition.event !== null) events.push(transition.event)
        }
      }
      events.push('OrderFilled')
    }

    // Orden pendiente resuelta sin relleno → rechazo del broker (única salida).
    if (this.pendingOrder !== null && !this.pendingOrder.isPending) {
      this.pendingOrder = null
      this.pendingKind = null
      events.push('OrderRejected')
    }

    // 4. Evaluación al cierre (siempre después del avance: sin look-ahead).
    const decision = this.strategy.evaluate(context, this.instance.open)
    events.push(...this.applyDecision(decision, context, candle.time))
    return events
  }

  private applyDecision(
    decision: StrategyDecision,
    context: MarketContext,
    time: number,
  ): ExecutionEvent[] {
    switch (decision.action) {
      case StrategyAction.None:
        return []

      case StrategyAction.Invalidate: {
        const events: ExecutionEvent[] = []
        // Cancela la orden de entrada o de ajuste; la de salida sigue su curso.
        if (this.pendingOrder !== null && this.pendingKind !== 'exit') {
          this.broker.cancelOrder(this.pendingOrder.id)
          this.pendingOrder = null
          this.pendingKind = null
          events.push('OrderCancelled')
        }
        const transition = this.instance.apply(decision)
        if (transition.event !== null) events.push(transition.event)
        return events
      }

      case StrategyAction.RequestEntry:
        return this.submitEntry(decision, context, time)

      case StrategyAction.RequestExit:
        return this.submitExit(decision, context, time)

      case StrategyAction.RequestAdd:
      case StrategyAction.RequestReduce:
        return this.submitAdjust(decision, context, time)
    }
  }

  private submitEntry(
    decision: StrategyDecision,
    context: MarketContext,
    time: number,
  ): ExecutionEvent[] {
    if (this.pendingOrder !== null) {
      // Refresh (chase) de la orden de entrada: se conserva, sin evento.
      this.instance.apply(decision)
      return []
    }

    const price = decision.price ?? context.current.close
    const qty = this.risk.entryQty(this.portfolio, price)
    if (qty === null) return [] // sin fondos: no se confirma ni se envía

    const events: ExecutionEvent[] = []
    const transition = this.instance.apply(decision) // → WaitingForEntryFill
    if (transition.event !== null) events.push(transition.event)

    const order = this.createOrder(OrderSide.Buy, decision.price, qty, time)
    this.broker.submitOrder(order)
    this.pendingOrder = order
    this.pendingKind = 'entry'
    events.push('OrderSubmitted')
    return events
  }

  private submitExit(
    decision: StrategyDecision,
    context: MarketContext,
    time: number,
  ): ExecutionEvent[] {
    const position = this.portfolio.position
    if (position === null || !position.isOpen) return [] // sin posición no se cierra

    const events: ExecutionEvent[] = []
    if (this.pendingOrder !== null) {
      if (this.pendingKind === 'adjust') {
        // La salida anula el ajuste en vuelo: cerrar manda.
        this.broker.cancelOrder(this.pendingOrder.id)
        this.pendingOrder = null
        this.pendingKind = null
        events.push('OrderCancelled')
      } else {
        // Refresh de la salida pendiente: se conserva, sin duplicar.
        this.instance.apply(decision)
        return events
      }
    }

    const transition = this.instance.apply(decision) // → WaitingForExitFill
    if (transition.event !== null) events.push(transition.event)

    const order = this.createOrder(OrderSide.Sell, decision.price, position.qty, time)
    this.broker.submitOrder(order)
    this.pendingOrder = order
    this.pendingKind = 'exit'
    events.push('OrderSubmitted')
    return events
  }

  private submitAdjust(
    decision: StrategyDecision,
    context: MarketContext,
    time: number,
  ): ExecutionEvent[] {
    if (this.pendingOrder !== null) return [] // como mucho una orden en vuelo

    const position = this.portfolio.position
    if (position === null || !position.isOpen) return []

    const fraction = decision.fraction
    if (fraction === null) return []

    const price = decision.price ?? context.current.close
    const qty =
      decision.action === StrategyAction.RequestReduce
        ? position.qty * fraction
        : this.risk.addQty(this.portfolio, price, fraction)
    if (qty === null || qty <= 0) return []

    this.instance.apply(decision) // self-loop: el ciclo no cambia
    const side = decision.action === StrategyAction.RequestReduce ? OrderSide.Sell : OrderSide.Buy
    const order = this.createOrder(side, decision.price, qty, time)
    this.broker.submitOrder(order)
    this.pendingOrder = order
    this.pendingKind = 'adjust'
    return ['OrderSubmitted']
  }

  private createOrder(side: OrderSide, price: number | null, qty: number, time: number): Order {
    this.orderSeq += 1
    return new Order({
      id: `o${this.orderSeq}`,
      side,
      type: price === null ? OrderType.Market : OrderType.Limit,
      qty,
      price: price ?? undefined,
      createdAt: time,
    })
  }
}
