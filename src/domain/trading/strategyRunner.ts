import { Candle } from '@/domain/candles/candle'
import { Broker } from '@/domain/execution/broker'
import { Fill } from '@/domain/execution/fill'
import { createOrder, Order, OrderSide } from '@/domain/execution/order'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskManager } from '@/domain/portfolio/riskManager'
import { MarketContext, OperationLevels } from '@/domain/strategies/marketContext'
import { Strategy, StrategyAction, StrategyDecision } from '@/domain/strategies/strategy'
import {
  StrategyEvent,
  StrategyInstance,
  StrategyTransition,
} from '@/domain/strategies/strategyInstance'
import { MarketClock } from '@/domain/time/marketClock'

/** Eventos del ciclo: los de dominio de la instancia + los de la ejecución (§12D). */
export type ExecutionEvent =
  StrategyEvent | 'OrderSubmitted' | 'OrderFilled' | 'OrderRejected' | 'OrderCancelled'

/**
 * Orden enviada por `submitDecisionOrder` junto con la transición de instancia
 * que la precede (el llamante la registra como evento/log).
 */
export interface DecisionOrderSubmission {
  order: Order
  transition: StrategyTransition
}

/**
 * Petición de envío de una decisión de entrada/salida: `referencePrice` y
 * `time` los aporta quien controla el reloj (el runner, la vela procesada; la
 * sesión, su referencia de simulación).
 */
export interface DecisionOrderRequest {
  decision: StrategyDecision
  /** `entry` ⇔ sizing de entrada; `exit` ⇔ posición completa (§6/§8). */
  kind: 'entry' | 'exit'
  /** Precio de referencia para valorar una entrada market (cierre de la vela). */
  referencePrice: number
  /** `createdAt` de la orden: tiempo de simulación (§12A). */
  time: number
  /** Id de la orden; solo se invoca si la operación resulta admisible. */
  nextId: () => string
}

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
    this.consumeFills(this.broker.advance(candle), events)

    // Orden pendiente resuelta sin relleno → rechazo del broker (única salida).
    if (this.pendingOrder !== null && !this.pendingOrder.isPending) {
      this.pendingOrder = null
      this.pendingKind = null
      events.push('OrderRejected')
    }

    // 4. Evaluación al cierre (siempre después del avance: sin look-ahead).
    // Niveles: `entry` = precio de relleno de la posición vigente (§1.6).
    // Se inyectan tras los rellenos para que SL/TP/`entry` vean el precio
    // real desde la misma vela en que se abre la posición.
    const position = this.portfolio.position
    const levels: OperationLevels = {
      entry: position !== null && position.isOpen ? position.avgEntryPrice : null,
    }
    const decision = this.strategy.evaluate(context.withLevels(levels), this.instance.open)
    events.push(...this.applyDecision(decision, context, candle.time))
    return events
  }

  /** Rellenos de la vela: resuelven la orden pendiente y transicionan la instancia. */
  private consumeFills(fills: readonly Fill[], events: ExecutionEvent[]): void {
    for (const fill of fills) {
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
          events.push(...this.cancelPending())
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

    const submission = this.submitDecisionOrder({
      decision,
      kind: 'entry',
      referencePrice: context.current.close,
      time,
      nextId: () => this.nextOrderId(),
    })
    if (submission === null) return [] // sin fondos: no se confirma ni se envía

    this.pendingOrder = submission.order
    this.pendingKind = 'entry'
    return this.submittedEvents(submission)
  }

  private submitExit(
    decision: StrategyDecision,
    context: MarketContext,
    time: number,
  ): ExecutionEvent[] {
    // Guard previo al bookkeeping: sin posición no se cierra (y no se toca nada).
    const position = this.portfolio.position
    if (position === null || !position.isOpen) return []

    const events: ExecutionEvent[] = []
    if (this.pendingOrder !== null) {
      if (this.pendingKind === 'adjust') {
        // La salida anula el ajuste en vuelo: cerrar manda.
        events.push(...this.cancelPending())
      } else {
        // Refresh de la salida pendiente: se conserva, sin duplicar.
        this.instance.apply(decision)
        return events
      }
    }

    const submission = this.submitDecisionOrder({
      decision,
      kind: 'exit',
      referencePrice: context.current.close,
      time,
      nextId: () => this.nextOrderId(),
    })
    // Inalcanzable (la guardia de arriba ya exige posición abierta con qty > 0).
    if (submission === null) return events

    this.pendingOrder = submission.order
    this.pendingKind = 'exit'
    events.push(...this.submittedEvents(submission))
    return events
  }

  /**
   * **Primitiva de envío compartida** (§6/§8): sizing de la decisión (entrada →
   * `RiskManager.entryQty` con el precio de la decisión o el de referencia;
   * salida → posición completa), transición de instancia y orden construida con
   * la regla común (`createOrder`: presencia de precio ⇔ `Limit`) enviada al
   * broker. El `nextId` del request se invoca **solo si la operación es
   * admisible**, así la secuencia de ids no avanza con intentos descartados.
   *
   * `null` ⇒ no admisible (sin fondos / sin posición): no se envía nada ni se
   * transiciona el ciclo. La usan `submitEntry`/`submitExit` (runner) y la
   * sesión (órdenes aceptadas por el usuario en test-forward): misma
   * semántica de sizing/precio/orden en todos los caminos.
   */
  submitDecisionOrder(request: DecisionOrderRequest): DecisionOrderSubmission | null {
    const { decision, kind, referencePrice, time, nextId } = request

    const position = this.portfolio.position
    const qty =
      kind === 'entry'
        ? this.risk.entryQty(this.portfolio, decision.price ?? referencePrice)
        : position !== null && position.isOpen
          ? position.qty
          : null
    if (qty === null || qty <= 0) return null

    const transition = this.instance.apply(decision) // → WaitingFor{Entry,Exit}Fill
    const order = createOrder({
      id: nextId(),
      side: kind === 'entry' ? OrderSide.Buy : OrderSide.Sell,
      price: decision.price,
      qty,
      createdAt: time,
    })
    this.broker.submitOrder(order)
    return { order, transition }
  }

  /** Eventos de un envío aceptado: la transición de instancia + el envío (§12D). */
  private submittedEvents(submission: DecisionOrderSubmission): ExecutionEvent[] {
    const events: ExecutionEvent[] = []
    if (submission.transition.event !== null) events.push(submission.transition.event)
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
    const order = createOrder({
      id: this.nextOrderId(),
      side,
      price: decision.price,
      qty,
      createdAt: time,
    })
    this.broker.submitOrder(order)
    this.pendingOrder = order
    this.pendingKind = 'adjust'
    return ['OrderSubmitted']
  }

  /** Cancela la orden en vuelo (de cualquier tipo); sin orden pendiente → sin eventos. */
  private cancelPending(): ExecutionEvent[] {
    if (this.pendingOrder === null) return []
    this.broker.cancelOrder(this.pendingOrder.id)
    this.pendingOrder = null
    this.pendingKind = null
    return ['OrderCancelled']
  }

  /** Siguiente id del runner (`o<n>`): determinista y solo avanza al enviar. */
  private nextOrderId(): string {
    this.orderSeq += 1
    return `o${this.orderSeq}`
  }
}
