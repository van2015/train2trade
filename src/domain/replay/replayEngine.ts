import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { Fill } from '@/domain/execution/fill'
import { Order, OrderSide, OrderStatus, OrderType } from '@/domain/execution/order'
import { ExecutionEvent } from '@/domain/trading/strategyRunner'
import { TradingSession, TradingSessionConfig } from '@/domain/trading/tradingSession'

/**
 * Estado de la reproducción (§7B): `ready` cubre el inicio y la pausa (ambos
 * admiten `step()` manual); `playing` lo marca el control del usuario (la UI
 * dispara los pasos con un timer); `finished` al procesar la última vela.
 */
export type ReplayStatus = 'ready' | 'playing' | 'finished'

export type ReplayLogKind = 'strategy' | 'order' | 'fill' | 'rejection' | 'manual'

export interface ReplayLogEntry {
  /** Tiempo de simulación (§12A) de la vela en la que ocurrió. */
  time: number
  kind: ReplayLogKind
  /** Texto listo para mostrar (español); los eventos de estrategia van con su nombre. */
  text: string
  orderId?: string
}

export interface ReplayStep {
  index: number
  time: number
  /** Estado tras el paso; `'finished'` al procesar la última vela. */
  status: ReplayStatus
  events: readonly ExecutionEvent[]
  /** Entradas nuevas desde el paso anterior (incluye manuales enviados entre medias). */
  log: readonly ReplayLogEntry[]
}

export class ReplayError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('ReplayError', invalidMessage('Replay inválido', reason, raw))
  }
}

/** Cantidad/precio legibles: 8 decimales sin ceros sobrantes (texto de log). */
function formatAmount(value: number): string {
  return String(Number(value.toFixed(8)))
}

/**
 * Reproducción histórica interactiva (§7B): controla el tiempo sobre el motor
 * compartido `TradingSession` (§7 — backtest y replay usan el mismo mecanismo
 * de reproducción; aquí la diferencia es quién lo gobierna). Determinista
 * (§12C): `reset()` reconstruye el stack con la misma config y repite el
 * mismo recorrido, sin `Date.now`.
 *
 * - **Estados:** `play`/`pause`/`step`/`reset` con transiciones estrictas
 *   (`ReplayError` en las inválidas). `step()` procesa exactamente una vela y
 *   conserva el anti look-ahead heredado del runner (orden de la vela N
 *   rellena en N+1): la estrategia solo ve lo disponible en ese instante.
 * - **Operaciones manuales (§7B):** `manualBuy`/`manualSell` por fracción con
 *   sizing de `RiskManager` (§8); orden **market** rellenada en la apertura de
 *   la **siguiente** vela, con id `m<n>` para distinguirlas en el log.
 * - **Orden única en vuelo:** no se acepta una orden manual si hay alguna
 *   pendiente (estrategia o manual). Preserva el supuesto de `RecordingBroker`
 *   (≤ 1 fill por vela → `Σ trades.pnl = realizedPnl`) y evita rechazos
 *   cruzados entre el usuario y la estrategia.
 * - **Log (§12D):** entradas por paso construidas a partir de los
 *   `ExecutionEvent[]` y de los diffs de órdenes/`fills` del decorador — sin
 *   bus de eventos. Las rechazos/cancelaciones se detectan por barrido de
 *   estado porque las órdenes manuales no emiten evento (el runner solo
 *   conoce las suyas).
 */
export class MarketReplayEngine {
  private readonly config: TradingSessionConfig
  private readonly decorator = (inner: Broker, account: Account): RecordingBroker =>
    new RecordingBroker(inner, account)

  private sessionValue: TradingSession<RecordingBroker>
  private statusValue: ReplayStatus = 'ready'
  private logEntries: ReplayLogEntry[] = []
  private manualIds = new Set<string>()
  private resolvedLogged = new Set<string>()
  private manualSeq = 0
  private ordersLogged = 0
  private fillsLogged = 0
  private lastStepLogIndex = 0

  constructor(config: TradingSessionConfig) {
    this.config = config
    this.sessionValue = new TradingSession(config, this.decorator)
  }

  /** Sesión compartida (§7): portfolio, instancia, reloj, broker con registro. */
  get session(): TradingSession<RecordingBroker> {
    return this.sessionValue
  }

  get status(): ReplayStatus {
    return this.statusValue
  }

  /** Velas procesadas; 0 antes del primer paso. */
  get cursor(): number {
    return this.sessionValue.cursor
  }

  /** Log completo, en orden; copia estable para la UI. */
  get log(): readonly ReplayLogEntry[] {
    return [...this.logEntries]
  }

  /** `ready|playing → playing`; `playing` o `finished` → `ReplayError`. */
  play(): void {
    if (this.statusValue === 'finished') {
      throw new ReplayError(
        'la reproducción ya terminó; reinicia para volver a empezar',
        'finished',
      )
    }
    if (this.statusValue === 'playing') {
      throw new ReplayError('la reproducción ya está en marcha', 'playing')
    }
    this.statusValue = 'playing'
  }

  /** `playing → ready`; en cualquier otro estado → `ReplayError`. */
  pause(): void {
    if (this.statusValue !== 'playing') {
      throw new ReplayError('la reproducción no está en marcha', this.statusValue)
    }
    this.statusValue = 'ready'
  }

  /**
   * Procesa una vela y devuelve su paso. Permitido en `ready` (paso manual) y
   * en `playing` (lo llama el timer); en `finished` → `ReplayError`.
   */
  step(): ReplayStep {
    if (this.statusValue === 'finished') {
      throw new ReplayError(
        'la reproducción ya terminó; reinicia para volver a empezar',
        'finished',
      )
    }

    const logStart = this.lastStepLogIndex
    const candleStep = this.sessionValue.advance()
    const time = candleStep.candle.time

    this.appendStepLog(candleStep.events, time)
    if (this.sessionValue.finished) {
      this.statusValue = 'finished'
    }
    this.lastStepLogIndex = this.logEntries.length

    return {
      index: candleStep.index,
      time,
      status: this.statusValue,
      events: candleStep.events,
      log: this.logEntries.slice(logStart),
    }
  }

  /**
   * Reinicia con la misma config: stack nuevo, `ready`, log vacío. Desde
   * cualquier estado (§12C: misma config → mismo recorrido).
   */
  reset(): void {
    this.sessionValue = new TradingSession(this.config, this.decorator)
    this.statusValue = 'ready'
    this.logEntries = []
    this.manualIds.clear()
    this.resolvedLogged.clear()
    this.manualSeq = 0
    this.ordersLogged = 0
    this.fillsLogged = 0
    this.lastStepLogIndex = 0
  }

  /**
   * Compra por fracción del equity (sizing de `RiskManager`, §8). `null` si
   * el riesgo no la admite; `finished` o orden en vuelo → `ReplayError`.
   * Rellena en la apertura de la siguiente vela (anti look-ahead).
   */
  manualBuy(fraction: number): Order | null {
    this.assertCanTrade()
    this.assertFraction(fraction)

    const qty = this.sessionValue.riskManager.addQty(
      this.sessionValue.portfolio,
      this.referencePrice(),
      fraction,
    )
    if (qty === null) return null
    return this.submitManual(OrderSide.Buy, qty)
  }

  /**
   * Venta por fracción de la posición abierta (reduce nunca se bloquea, §8).
   * Sin posición → `null`; `finished` o orden en vuelo → `ReplayError`.
   */
  manualSell(fraction: number): Order | null {
    this.assertCanTrade()
    this.assertFraction(fraction)

    const position = this.sessionValue.portfolio.position
    if (position === null || !position.isOpen) return null

    const qty = position.qty * fraction
    if (qty <= 0) return null
    return this.submitManual(OrderSide.Sell, qty)
  }

  /** Regla de orden única en vuelo + no operar en `finished`. */
  private assertCanTrade(): void {
    if (this.statusValue === 'finished') {
      throw new ReplayError(
        'la reproducción ya terminó; reinicia para volver a empezar',
        'finished',
      )
    }
    if (this.sessionValue.broker.pendingOrders().length > 0) {
      throw new ReplayError(
        'ya hay una orden en vuelo (manual o de la estrategia): espera a que se resuelva',
        'pending',
      )
    }
  }

  private assertFraction(fraction: number): void {
    if (
      typeof fraction !== 'number' ||
      !Number.isFinite(fraction) ||
      fraction <= 0 ||
      fraction > 1
    ) {
      throw new ReplayError('fraction debe ser un número en (0, 1]', fraction)
    }
  }

  /**
   * Precio de referencia para valorar la operación: cierre de la última vela
   * procesada; antes del primer paso, la apertura de la primera vela (la
   * orden rellena justo en esa apertura).
   */
  private referencePrice(): number {
    const candles = this.sessionValue.candles
    const last = candles[this.sessionValue.cursor - 1]
    if (last !== undefined) return last.close

    const first = candles[0]
    if (first === undefined) {
      throw new ReplayError('la sesión no tiene velas', candles.length)
    }
    return first.open
  }

  /** Tiempo para la orden manual: reloj actual o, sin avanzar, la primera vela. */
  private referenceTime(): number {
    const now = this.sessionValue.clock.now
    if (now !== null) return now

    const first = this.sessionValue.candles[0]
    if (first === undefined) {
      throw new ReplayError('la sesión no tiene velas', this.sessionValue.candles.length)
    }
    return first.time
  }

  private submitManual(side: OrderSide, qty: number): Order {
    this.manualSeq += 1
    const id = `m${this.manualSeq}`
    const time = this.referenceTime()
    const order = new Order({ id, side, type: OrderType.Market, qty, createdAt: time })

    this.sessionValue.broker.submitOrder(order)
    // Sin evento `OrderSubmitted` (el runner no envía estas órdenes): se consume
    // el registro aquí para que los índices del log sigan alineados.
    this.ordersLogged += 1
    this.manualIds.add(id)

    const verb = side === OrderSide.Buy ? 'comprar' : 'vender'
    this.logEntries.push({
      time,
      kind: 'manual',
      text: `Orden manual enviada: ${verb} ${formatAmount(qty)} (${id})`,
      orderId: id,
    })
    return order
  }

  /**
   * Entradas de log de un paso, en orden:
   * 1. resoluciones por barrido (rechazo/cancelación) — las manuales no
   *    emiten evento y ocurren en el avance, antes de decidir;
   * 2. eventos del paso: envíos y rellenos (con payload del decorador) y
   *    eventos de estrategia (nombres de dominio).
   */
  private appendStepLog(events: readonly ExecutionEvent[], time: number): void {
    for (const order of this.sessionValue.broker.orders) {
      if (order.status === OrderStatus.Pending || order.status === OrderStatus.Filled) continue
      if (this.resolvedLogged.has(order.id)) continue
      this.resolvedLogged.add(order.id)

      const manual = this.manualIds.has(order.id)
      if (order.status === OrderStatus.Rejected) {
        const reason = order.rejectReason ?? 'sin motivo'
        this.logEntries.push({
          time,
          kind: manual ? 'manual' : 'rejection',
          text: manual
            ? `Orden manual rechazada (${order.id}): ${reason}`
            : `Orden rechazada (${order.id}): ${reason}`,
          orderId: order.id,
        })
      } else {
        this.logEntries.push({
          time,
          kind: 'order',
          text: `Orden cancelada (${order.id})`,
          orderId: order.id,
        })
      }
    }

    for (const event of events) {
      switch (event) {
        case 'OrderSubmitted': {
          const order = this.nextOrder()
          if (order === undefined) break
          const verb = order.side === OrderSide.Buy ? 'comprar' : 'vender'
          this.logEntries.push({
            time,
            kind: 'order',
            text: `Orden enviada: ${verb} ${formatAmount(order.qty)} (${order.id})`,
            orderId: order.id,
          })
          break
        }
        case 'OrderFilled': {
          const fill = this.nextFill()
          if (fill === undefined) break
          const buy = fill.side === OrderSide.Buy
          const subject = `${buy ? 'Compra' : 'Venta'}${this.manualIds.has(fill.orderId) ? ' manual' : ''} rellenada`
          this.logEntries.push({
            time,
            kind: this.manualIds.has(fill.orderId) ? 'manual' : 'fill',
            text: `${subject}: ${formatAmount(fill.qty)} @ ${formatAmount(fill.price)} (${fill.orderId})`,
            orderId: fill.orderId,
          })
          break
        }
        case 'OrderRejected':
        case 'OrderCancelled':
          break // ya registradas por el barrido anterior (incluye manuales sin evento)
        default:
          this.logEntries.push({ time, kind: 'strategy', text: event })
      }
    }
  }

  /** Siguiente orden aún no registrada en el log (el registro es append-only). */
  private nextOrder(): Order | undefined {
    const order = this.sessionValue.broker.orders[this.ordersLogged]
    if (order !== undefined) this.ordersLogged += 1
    return order
  }

  /** Siguiente fill aún no registrado en el log (append-only, en orden). */
  private nextFill(): Fill | undefined {
    const fill = this.sessionValue.broker.fills[this.fillsLogged]
    if (fill !== undefined) this.fillsLogged += 1
    return fill
  }
}
