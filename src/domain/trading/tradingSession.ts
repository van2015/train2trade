import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Account } from '@/domain/execution/account'
import { Broker } from '@/domain/execution/broker'
import { ExecutionModelConfig, NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { createOrder, Order, OrderSide } from '@/domain/execution/order'
import { Position } from '@/domain/execution/position'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskConfig, RiskManager } from '@/domain/portfolio/riskManager'
import { Strategy, StrategyDecision } from '@/domain/strategies/strategy'
import { StrategyInstance } from '@/domain/strategies/strategyInstance'
import { MarketClock } from '@/domain/time/marketClock'
import {
  DecisionOrderRequest,
  DecisionOrderSubmission,
  ExecutionEvent,
  StrategyRunner,
} from '@/domain/trading/strategyRunner'

/**
 * Riesgo de una sesión **sin costes**: `feeBps`/`slippageBps` no se aceptan
 * aquí porque la fuente única es `execution` (§: "debe coincidir con el
 * ExecutionModel"). `runBacktest` los deriva del modelo construido.
 */
export type SessionRiskConfig = Omit<RiskConfig, 'feeBps' | 'slippageBps'>

export interface TradingSessionConfig {
  strategy: Strategy
  /** Velas ascendentes y no vacías (se validan de forma incremental al recorrerlas). */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento (§12C). */
  timeframe: Timeframe
  initialCapital: number
  /** Slippage/fee: fuente única de costes; el `risk` estimado se deriva de aquí. */
  execution?: ExecutionModelConfig
  risk?: SessionRiskConfig
}

/** Problema de configuración detectado antes de ejecutar. */
export interface ConfigProblem {
  reason: string
  raw: unknown
}

/**
 * Reglas de validación de la config de sesión: **fuente única** compartida por
 * `runBacktest` (que la traduce a `BacktestError`), `Experiment.run` (a
 * `ExperimentError`) y `TradingSession` (a `TradingSessionError`), para no
 * duplicar los checks en varios módulos.
 */
export function findConfigProblem(config: TradingSessionConfig): ConfigProblem | null {
  if (config.candles.length === 0) {
    return { reason: 'se necesita al menos una vela', raw: config.candles.length }
  }
  if (!(config.timeframe instanceof Timeframe)) {
    return { reason: 'timeframe debe ser un Timeframe', raw: config.timeframe }
  }
  if (
    typeof config.initialCapital !== 'number' ||
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0
  ) {
    return { reason: 'initialCapital debe ser un número finito > 0', raw: config.initialCapital }
  }
  return null
}

/** Resultado de procesar una vela con `TradingSession.advance`. */
export interface CandleStep {
  /** Índice de la vela procesada (0-based). */
  index: number
  candle: Candle
  /** Eventos de ejecución (§12D) de esta vela, en orden. */
  events: readonly ExecutionEvent[]
  /** Equity marcado a mercado al cierre de la vela. */
  equity: number
}

export class TradingSessionError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('TradingSessionError', invalidMessage('Sesión de trading inválida', reason, raw))
  }
}

/**
 * Decorador del broker interno: permite envolver el `HistoricalBroker` con
 * observabilidad (p. ej. `RecordingBroker`) **sin** que el paquete `trading`
 * importe de `backtest` — así el grafo de dependencias sigue siendo un árbol
 * (`backtest → trading`, nunca al revés, §14).
 */
export type BrokerDecorator<B extends Broker> = (inner: Broker, account: Account) => B

/**
 * Motor de reproducción compartido (§5/§7/§14): ensambla el stack de la Fase 3
 * (`Portfolio + RiskManager + HistoricalBroker + StrategyRunner + MarketClock`)
 * y lo avanza **vela a vela**. Es la misma ejecución que usa `runBacktest`
 * (bucle automático) y la que usará el replay interactivo de la Fase 5: la
 * única diferencia entre ambos es quién controla el tiempo y cómo se presenta
 * (§7 "compartir el motor de reproducción").
 *
 * Orden anti look-ahead (heredado del runner): por vela, avance de mercado →
 * decisión → envío; la orden de la vela N rellena en N+1. Determinista
 * (§12C): misma config → mismo recorrido, sin `Date.now`.
 *
 * El genérico `B` tipa el broker resultante cuando se inyecta un decorador:
 * `new TradingSession(config, (inner, account) => new RecordingBroker(inner,
 * account))` da una `TradingSession<RecordingBroker>`. Sin decorador, `B`
 * cae en su default `Broker`.
 *
 * La curva de equity **no** se acumula aquí: cada `CandleStep` lleva su
 * `equity` y la acumula el consumidor (backtest, replay), que es quien decide
 * qué hacer con ella.
 */
export class TradingSession<B extends Broker = Broker> {
  readonly candles: readonly Candle[]
  readonly timeframe: Timeframe
  readonly portfolio: Portfolio
  readonly riskManager: RiskManager
  /** Tiempo de simulación (§12A): avanza con cada vela aceptada. */
  readonly clock: MarketClock
  readonly instance: StrategyInstance
  readonly broker: B
  /** Config efectiva de ejecución (defaults resueltos) — §12C. */
  readonly executionConfig: Required<ExecutionModelConfig>
  /** Config efectiva de riesgo (defaults resueltos) — §12C. */
  readonly riskConfig: Required<RiskConfig>

  private readonly runner: StrategyRunner
  private readonly eventLog: ExecutionEvent[] = []
  private cursorValue = 0

  constructor(config: TradingSessionConfig, decorateBroker?: BrokerDecorator<B>) {
    const problem = findConfigProblem(config)
    if (problem !== null) {
      throw new TradingSessionError(problem.reason, problem.raw)
    }

    const { strategy, candles, timeframe, initialCapital, execution, risk } = config

    this.candles = candles
    this.timeframe = timeframe
    this.portfolio = new Portfolio(initialCapital)

    const executionModel = new NextOpenExecutionModel(execution)
    // Costes estimados := costes reales (fuente única: `execution`).
    const riskManager = new RiskManager({ ...risk, ...executionModel.config })
    const inner = new HistoricalBroker(this.portfolio, executionModel)
    const base: Broker =
      decorateBroker !== undefined ? decorateBroker(inner, this.portfolio) : inner
    // Sin decorador `B` es `Broker` (default del genérico): el cast solo estrecha
    // el tipo; la instancia es exactamente el broker construido arriba.
    this.broker = base as B

    this.riskManager = riskManager
    this.clock = new MarketClock()
    this.runner = new StrategyRunner(strategy, this.broker, this.portfolio, riskManager, this.clock)
    this.instance = this.runner.instance
    this.executionConfig = executionModel.config
    this.riskConfig = riskManager.config
  }

  /** Velas procesadas; 0 antes del primer avance. */
  get cursor(): number {
    return this.cursorValue
  }

  /** `true` cuando ya no quedan velas por procesar. */
  get finished(): boolean {
    return this.cursorValue >= this.candles.length
  }

  /** Posición larga abierta; `null` sin posición o tras el cierre total (§8). */
  get position(): Position | null {
    return this.portfolio.position
  }

  /** Secuencia aplanada de eventos de ejecución (§12D), en orden. */
  get events(): readonly ExecutionEvent[] {
    return [...this.eventLog]
  }

  /**
   * Órdenes todavía en vuelo (esperando relleno, cancelación o rechazo):
   * regla de "orden única en vuelo" que imponen replay y test-forward.
   */
  pendingOrderCount(): number {
    return this.broker.pendingOrders().length
  }

  /**
   * Cantidad admisible para **aumentar** la posición con `fraction` del
   * presupuesto disponible (§8), valorando a la referencia de la sesión.
   * `null` si el riesgo no la admite (mismo contrato que `RiskManager.addQty`).
   */
  addQty(fraction: number): number | null {
    return this.riskManager.addQty(this.portfolio, this.referencePrice(), fraction)
  }

  /**
   * Precio de referencia para valorar una operación manual: cierre de la
   * última vela procesada; antes del primer avance, apertura de la primera
   * vela (la orden rellena justo en esa apertura, anti look-ahead).
   */
  referencePrice(): number {
    const last = this.candles[this.cursorValue - 1]
    return last !== undefined ? last.close : this.firstCandle().open
  }

  /**
   * Tiempo de simulación para una orden nueva (§12A): el reloj actual o, sin
   * haber avanzado, el timestamp de la primera vela.
   */
  referenceTime(): number {
    return this.clock.now ?? this.firstCandle().time
  }

  /**
   * Construye y envía una orden **market** al broker en el tiempo de
   * simulación actual (operaciones manuales del replay, §7B). El `id` lo
   * aporta el llamante (`m<n>`, determinista) y el tipo se infiere de la
   * ausencia de precio (`createOrder`).
   */
  submitOrder(spec: { id: string; side: OrderSide; qty: number }): Order {
    const order = createOrder({
      id: spec.id,
      side: spec.side,
      price: null,
      qty: spec.qty,
      createdAt: this.referenceTime(),
    })
    this.broker.submitOrder(order)
    return order
  }

  /** Cancela una orden pendiente de la sesión (par de `submitOrder`). */
  cancelOrder(orderId: string): void {
    this.broker.cancelOrder(orderId)
  }

  /**
   * Envía la orden de una decisión de entrada/salida con la **misma
   * semántica** que el runner (§6/§8): sizing, transición de instancia e
   * inferencia de tipo de orden viven en `StrategyRunner.submitDecisionOrder`,
   * compartida por todos los caminos. La sesión aporta aquí la referencia de
   * precio y el tiempo de simulación (lo que antes calculaba cada consumidor).
   *
   * `null` ⇒ operación no admisible (sin fondos / sin posición): no se envía
   * nada ni cambia el ciclo. `nextId` solo se invoca si se envía.
   */
  submitDecisionOrder(
    request: Omit<DecisionOrderRequest, 'referencePrice' | 'time'>,
  ): DecisionOrderSubmission | null {
    return this.runner.submitDecisionOrder({
      ...request,
      referencePrice: this.referencePrice(),
      time: this.referenceTime(),
    })
  }

  /**
   * Procesa la siguiente vela y devuelve su paso. Si la sesión terminó →
   * `TradingSessionError`. Un fallo de validación (velas fuera de orden) se
   * propaga **antes** de mutar el cursor: la llamada inválida no avanza nada.
   */
  advance(): CandleStep {
    if (this.finished) {
      throw new TradingSessionError(
        `la sesión ya procesó todas las velas (${this.candles.length})`,
        this.cursorValue,
      )
    }

    const index = this.cursorValue
    const candle = this.candles[index]
    // Inalcanzable (`index < candles.length`): lo pide noUncheckedIndexedAccess.
    if (candle === undefined) {
      throw new TradingSessionError('la vela solicitada no existe', index)
    }

    // El reloj lo avanza el runner (§12A): este método no duplica la regla.
    const events = this.runner.onCandle(this.candles.slice(0, index + 1))
    this.eventLog.push(...events)
    this.cursorValue = index + 1

    return { index, candle, events, equity: this.portfolio.equity(candle.close) }
  }

  /** Primera vela de la sesión (≥ 1 por `findConfigProblem`); evita `undefined`. */
  private firstCandle(): Candle {
    const first = this.candles[0]
    if (first === undefined) {
      throw new TradingSessionError('la sesión no tiene velas', this.candles.length)
    }
    return first
  }
}
