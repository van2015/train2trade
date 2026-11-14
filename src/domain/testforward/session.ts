import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { Candle } from '@/domain/candles/candle'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { Fill } from '@/domain/execution/fill'
import { Order, OrderSide, OrderStatus, OrderType } from '@/domain/execution/order'
import { MarketContext, OperationLevels } from '@/domain/strategies/marketContext'
import { Strategy, StrategyAction, StrategyDecision } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { TradingSession, TradingSessionConfig } from '@/domain/trading/tradingSession'
import { confirmationPoints } from './confirmationPoints'

/** Estado de la sesión (§2.1): `awaiting` = pausada esperando `decide()`. */
export type TestForwardStatus = 'idle' | 'awaiting' | 'finished'

export type ConfirmationKind = 'entry' | 'exit'

/** Confirmación pausada: la señal de la estrategia que el usuario debe decidir. */
export interface Confirmation {
  kind: ConfirmationKind
  decision: StrategyDecision
}

export type TestForwardLogKind =
  'confirmation' | 'decision' | 'order' | 'fill' | 'rejection' | 'event'

export interface TestForwardLogEntry {
  /** Tiempo de simulación (§12A) en el que ocurrió. */
  time: number
  kind: TestForwardLogKind
  /** Texto listo para mostrar (español). */
  text: string
}

export class TestForwardError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('TestForwardError', invalidMessage('Sesión de test-forward inválida', reason, raw))
  }
}

const NONE: StrategyDecision = {
  action: StrategyAction.None,
  fraction: null,
  price: null,
  reason: null,
}

/**
 * Estrategia de la sesión (§2.1/§2.2): envuelve la definición del usuario y
 *
 * 1. inyecta los overrides de TP/SL de la sesión en el contexto (`sl`/`tp`
 *    efectivos; sin override → automático);
 * 2. **suprime** las señales de la estrategia (entrada y salida por regla) y
 *    las convierte en `confirmation` para que el usuario decida (§2.1.3);
 * 3. deja pasar TP/SL, triggers y veto tal cual (§2.1.5: se ejecutan solos).
 *
 * La fuente de la decisión se identifica por `reason === signal.name`
 * (formato `"acción: regla"`; los triggers usan `"acción @ expresión"` — sin
 * colisión posible), de modo que la prioridad la sigue decidiendo
 * `Strategy.evaluate` sin replicarla.
 */
class TestForwardStrategy extends Strategy {
  /** Confirmación detectada en la última evaluación (null si no hubo). */
  confirmation: Confirmation | null = null
  /** Override de sesión: undefined = automático, null = desactivado, número = manual. */
  slOverride: number | null | undefined = undefined
  tpOverride: number | null | undefined = undefined
  /** Orden propia (entrada/salida aceptada) en vuelo → silencia nuevas señales. */
  entryBlocked = false
  exitBlocked = false

  constructor(base: Strategy) {
    super({
      name: base.name,
      version: base.version,
      indicators: base.indicators,
      signals: base.signals,
      invalidationRule: base.invalidationRule ?? undefined,
      takeProfit: base.takeProfit ?? undefined,
      stopLoss: base.stopLoss ?? undefined,
      triggers: base.triggers,
    })
  }

  override evaluate(context: MarketContext, open: boolean): StrategyDecision {
    const decision = super.evaluate(this.injectLevels(context), open)
    this.confirmation = null

    if (
      decision.action !== StrategyAction.RequestEntry &&
      decision.action !== StrategyAction.RequestExit
    ) {
      return decision
    }
    if (!this.fromSignal(decision)) return decision // trigger u otra fuente → sola

    const kind = decision.action === StrategyAction.RequestEntry ? 'entry' : 'exit'
    const blocked = kind === 'entry' ? this.entryBlocked : this.exitBlocked
    if (!blocked) this.confirmation = { kind, decision }
    return NONE // la ejecución de la señal la decide el usuario
  }

  /** ¿La decisión salió de una señal (regla) y no de un trigger o nivel? */
  private fromSignal(decision: StrategyDecision): boolean {
    return this.signals.some(
      (signal) => signal.action === decision.action && signal.name === decision.reason,
    )
  }

  /** Contexto con los overrides de sesión inyectados (fusiona con los actuales). */
  private injectLevels(context: MarketContext): MarketContext {
    const levels: OperationLevels = {}
    if (this.slOverride !== undefined) levels.sl = this.slOverride
    if (this.tpOverride !== undefined) levels.tp = this.tpOverride
    return context.withLevels(levels)
  }
}

/**
 * Decorador que notifica a la sesión los rellenos **durante** `advance` (paso 3
 * del runner, antes de evaluar): así la instancia de las órdenes aceptadas por
 * el usuario transiciona con exactitud de una vela y los SL/TP/exitRule de la
 * vela del relleno ya la ven abierta (sin hueco anti look-ahead).
 */
export class TestForwardBroker extends RecordingBroker {
  private readonly onFillHook: (fill: Fill) => void

  constructor(inner: Broker, account: Account, onFillHook: (fill: Fill) => void) {
    super(inner, account)
    this.onFillHook = onFillHook
  }

  override advance(candle: Candle): Fill[] {
    const fills = super.advance(candle)
    for (const fill of fills) this.onFillHook(fill)
    return fills
  }
}

/** Cantidad/precio legibles: 8 decimales sin ceros sobrantes (texto de log). */
function formatAmount(value: number): string {
  return String(Number(value.toFixed(8)))
}

/**
 * Test-forward interactivo (§2.1/§2.2): controla el tiempo sobre el motor
 * compartido `TradingSession` (§7 — mismo motor que backtest y replay) con la
 * diferencia de que **las señales de entrada/salida de la estrategia esperan
 * al usuario** (`decide(take)`), mientras TP/SL, triggers y veto se ejecutan
 * solos.
 *
 * - `start`/`jump` eligen un punto futuro de `confirmationPoints` con el RNG
 *   inyectado (§2.1.2); `step` procesa una vela. Las salidas por regla
 *   interrumpen cualquier avance; las entradas intermedias de un `jump` se
 *   descartan (el destino manda, §2.1.4).
 * - **Anti look-ahead**: `decide(true)` en la vela N envía la orden (mismo
 *   sizing/precio que el runner) y rellena en la apertura de N+1.
 * - Determinista con RNG inyectado (§12C): `reset()` reconstruye el stack.
 */
export class TestForwardSession {
  private readonly config: TradingSessionConfig
  private readonly random: () => number
  private readonly pointsValue: readonly number[]
  private readonly decorator = (inner: Broker, account: Account): TestForwardBroker =>
    new TestForwardBroker(inner, account, (fill) => this.handleTakeFill(fill))

  private strategyValue: TestForwardStrategy
  private sessionValue: TradingSession<TestForwardBroker>
  private statusValue: TestForwardStatus = 'idle'
  private confirmationValue: Confirmation | null = null
  private pendingTake: { order: Order; kind: ConfirmationKind } | null = null
  private takeFill: Fill | null = null
  private takeSeq = 0
  private logEntries: TestForwardLogEntry[] = []

  constructor(config: TradingSessionConfig, random: () => number = Math.random) {
    this.config = config
    this.random = random
    this.pointsValue = confirmationPoints(config.strategy, config.candles)
    this.strategyValue = new TestForwardStrategy(config.strategy)
    this.sessionValue = new TradingSession(
      { ...config, strategy: this.strategyValue },
      this.decorator,
    )
  }

  /** Sesión compartida (§7): portfolio, instancia, reloj, broker con registro. */
  get session(): TradingSession<TestForwardBroker> {
    return this.sessionValue
  }

  get status(): TestForwardStatus {
    return this.statusValue
  }

  /** Velas procesadas; 0 antes del primer avance. */
  get cursor(): number {
    return this.sessionValue.cursor
  }

  /** Confirmación pausa pendiente; null en cualquier otro estado. */
  get confirmation(): Confirmation | null {
    return this.confirmationValue
  }

  /** Puntos de entrada estadoless (§2.2): destinos posibles de `jump`. */
  get points(): readonly number[] {
    return [...this.pointsValue]
  }

  /** Log de decisiones (§2.1), en orden; copia estable para la UI. */
  get log(): readonly TestForwardLogEntry[] {
    return [...this.logEntries]
  }

  /**
   * Salta a un punto de confirmación futuro al azar y pausa en él (§2.1.2).
   * Sin candidatos → procesa el resto y termina.
   */
  start(): void {
    this.jump()
  }

  /**
   * Decide la confirmación pausada: `true` = tomar (entrada) / cerrar (salida);
   * `false` = descartar / mantener. Sin pausa → `TestForwardError`.
   */
  decide(take: boolean): void {
    const confirmation = this.confirmationValue
    if (this.statusValue !== 'awaiting' || confirmation === null) {
      throw new TestForwardError('no hay confirmación pendiente que decidir', this.statusValue)
    }
    this.confirmationValue = null
    this.statusValue = 'idle'

    if (!take) {
      const text = confirmation.kind === 'entry' ? 'Entrada descartada' : 'Salida mantenida'
      this.pushLog('decision', text)
      this.syncFinished()
      return
    }
    this.submitTake(confirmation)
    this.syncFinished()
  }

  /** Procesa exactamente una vela; pausa ante cualquier confirmación (§2.1.4). */
  step(): void {
    this.assertAdvance()
    this.advanceOne(this.sessionValue.cursor)
  }

  /** Salta a un punto futuro al azar; sin candidatos → corre hasta el final. */
  jump(): void {
    this.assertAdvance()
    const target = this.pickTarget()
    if (target === null) {
      this.runToEnd()
      return
    }
    while (this.sessionValue.cursor <= target && !this.sessionValue.finished) {
      this.advanceOne(target)
      if (this.statusValue === 'awaiting') break
    }
    this.syncFinished()
  }

  /**
   * Reinicia con la misma config: stack nuevo, `idle`, log vacío y overrides
   * a automático (§12C: misma config → mismo recorrido con el mismo RNG).
   */
  reset(): void {
    this.strategyValue = new TestForwardStrategy(this.config.strategy)
    this.sessionValue = new TradingSession(
      { ...this.config, strategy: this.strategyValue },
      this.decorator,
    )
    this.statusValue = 'idle'
    this.confirmationValue = null
    this.pendingTake = null
    this.takeFill = null
    this.takeSeq = 0
    this.logEntries = []
  }

  /**
   * Take-profit: `enabled=false` → desactivado; `price=null` con `enabled` →
   * automático (la expresión de la estrategia); número → override manual.
   * Solo surte efecto si la estrategia declara el nivel (§1.5).
   */
  setTakeProfit(price: number | null, enabled: boolean): void {
    this.strategyValue.tpOverride = this.levelOverride(price, enabled, 'takeProfit')
  }

  /** Igual que `setTakeProfit` para el stop-loss. */
  setStopLoss(price: number | null, enabled: boolean): void {
    this.strategyValue.slOverride = this.levelOverride(price, enabled, 'stopLoss')
  }

  private levelOverride(
    price: number | null,
    enabled: boolean,
    field: string,
  ): number | null | undefined {
    if (!enabled) return null
    if (price === null) return undefined
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      throw new TestForwardError(`${field}: el precio debe ser un número finito`, price)
    }
    return price
  }

  /** Transiciones inválidas: pausa pendiente o sesión terminada. */
  private assertAdvance(): void {
    if (this.statusValue === 'awaiting') {
      throw new TestForwardError(
        'hay una confirmación pendiente: usa decide() antes de continuar',
        'awaiting',
      )
    }
    if (this.statusValue === 'finished' || this.sessionValue.finished) {
      throw new TestForwardError('la sesión ya terminó; reinicia para volver a empezar', 'finished')
    }
  }

  /** Siguiente punto futuro al azar; `null` si no quedan candidatos. */
  private pickTarget(): number | null {
    const cursor = this.sessionValue.cursor
    const candidates = this.pointsValue.filter((point) => point >= cursor)
    if (candidates.length === 0) return null
    const index = Math.min(Math.floor(this.random() * candidates.length), candidates.length - 1)
    return candidates[index] ?? null
  }

  /** Procesa una vela y gestiona la confirmación resultante. */
  private advanceOne(entryTarget: number | null): void {
    const step = this.sessionValue.advance()
    this.resolveTake(step.events)

    const found = this.strategyValue.confirmation
    if (found !== null) {
      const index = this.sessionValue.cursor - 1
      const pauseHere = found.kind === 'exit' || (entryTarget !== null && index === entryTarget)
      if (pauseHere) this.pause(found)
    }
    this.syncFinished()
  }

  /** Pausa la sesión sobre una confirmación (§2.1.2). */
  private pause(found: Confirmation): void {
    this.confirmationValue = found
    this.statusValue = 'awaiting'
    const label = found.kind === 'entry' ? 'entrada' : 'salida'
    this.pushLog('confirmation', `Confirmación de ${label}: ${found.decision.reason ?? 'señal'}`)
  }

  /** Corre el resto de velas; una salida por regla interrumpe (§2.2). */
  private runToEnd(): void {
    while (!this.sessionValue.finished) {
      this.advanceOne(null)
      if (this.statusValue === 'awaiting') return
    }
    this.statusValue = 'finished'
  }

  /** `idle` + sin velas pendientes → `finished`. */
  private syncFinished(): void {
    if (this.statusValue === 'idle' && this.sessionValue.finished) {
      this.statusValue = 'finished'
    }
  }

  /** Orden propia aceptada por el usuario (§2.1: misma semántica que el runner). */
  private submitTake(confirmation: Confirmation): void {
    const { decision } = confirmation
    const isEntry = confirmation.kind === 'entry'
    const price = decision.price
    const reference = price ?? this.lastCandle().close
    const position = this.sessionValue.portfolio.position
    const qty = isEntry
      ? this.sessionValue.riskManager.entryQty(this.sessionValue.portfolio, reference)
      : position !== null && position.isOpen
        ? position.qty
        : null

    if (qty === null || qty <= 0) {
      const text = isEntry ? 'Entrada no admitida (riesgo)' : 'Salida no admitida (sin posición)'
      this.pushLog('decision', text)
      return
    }

    this.pushLog('decision', isEntry ? 'Entrada tomada' : 'Salida ejecutada')
    const transition = this.sessionValue.instance.apply(decision)
    if (transition.event !== null) this.pushLog('event', transition.event)

    this.takeSeq += 1
    const order = new Order({
      id: `t${this.takeSeq}`,
      side: isEntry ? OrderSide.Buy : OrderSide.Sell,
      type: price === null ? OrderType.Market : OrderType.Limit,
      qty,
      price: price ?? undefined,
      createdAt: this.now(),
    })
    this.sessionValue.broker.submitOrder(order)
    this.pendingTake = { order, kind: confirmation.kind }
    if (isEntry) this.strategyValue.entryBlocked = true
    else this.strategyValue.exitBlocked = true

    const verb = isEntry ? 'comprar' : 'vender'
    this.pushLog('order', `Orden enviada: ${verb} ${formatAmount(qty)} (${order.id})`)
  }

  /**
   * Relleno de la orden propia: notificado por `TestForwardBroker.advance`
   * durante el paso 3 del runner (antes de evaluar) → la instancia queda
   * abierta/cerrada para la misma vela del relleno.
   */
  private handleTakeFill(fill: Fill): void {
    const pending = this.pendingTake
    if (pending === null || fill.orderId !== pending.order.id) return

    const expected =
      pending.kind === 'entry'
        ? StrategyState.WaitingForEntryFill
        : StrategyState.WaitingForExitFill
    const instance = this.sessionValue.instance
    if (instance.state !== expected) return // el veto u otro motivo ya movió el ciclo

    const transition = instance.onFill()
    this.takeFill = fill
    if (transition.event !== null) this.pushLog('event', transition.event)
  }

  /** Resolución de la orden propia tras cada avance (relleno o rechazo). */
  private resolveTake(events: readonly string[]): void {
    const pending = this.pendingTake
    if (pending === null) return

    if (pending.order.isPending) {
      // El veto retira la orden de entrada aceptada (misma semántica que el runner).
      if (pending.kind === 'entry' && events.includes('EntryCancelled')) {
        this.sessionValue.broker.cancelOrder(pending.order.id)
        this.pendingTake = null
        this.strategyValue.entryBlocked = false
        this.pushLog('rejection', `Orden de entrada retirada por veto (${pending.order.id})`)
      }
      return
    }

    if (pending.order.status === OrderStatus.Filled) {
      const fill = this.takeFill
      this.takeFill = null
      if (fill !== null) {
        const subject = fill.side === OrderSide.Buy ? 'Compra' : 'Venta'
        this.pushLog(
          'fill',
          `${subject} rellenada: ${formatAmount(fill.qty)} @ ${formatAmount(fill.price)} (${fill.orderId})`,
        )
      }
    } else {
      const reason = pending.order.rejectReason ?? pending.order.status
      this.pushLog('rejection', `Orden no ejecutada (${pending.order.id}): ${reason}`)
    }
    this.pendingTake = null
    this.strategyValue.entryBlocked = false
    this.strategyValue.exitBlocked = false
  }

  /** Última vela procesada (la de la confirmación) o la primera si no hay. */
  private lastCandle(): Candle {
    const candles = this.sessionValue.candles
    return candles[this.sessionValue.cursor - 1] ?? candles[0] ?? emptyCandle()
  }

  /** Tiempo de simulación actual (§12A); antes del primer avance, la primera vela. */
  private now(): number {
    return this.sessionValue.clock.now ?? this.lastCandle().time
  }

  private pushLog(kind: TestForwardLogKind, text: string): void {
    this.logEntries.push({ time: this.now(), kind, text })
  }
}

/** Imposible con config válida (TradingSession exige ≥ 1 vela); evita `undefined`. */
function emptyCandle(): Candle {
  return Candle.from({ time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 })
}
