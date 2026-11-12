import { computeMetrics, EquityPoint, Metrics } from '@/domain/backtest/metrics'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { feeFor, withSlippage } from '@/domain/execution/costs'
import { ExecutionModelConfig } from '@/domain/execution/executionModel'
import { Fill } from '@/domain/execution/fill'
import { Instrument } from '@/domain/instruments/instrument'
import { Order, OrderSide, OrderType } from '@/domain/execution/order'
import { RiskConfig } from '@/domain/portfolio/riskManager'
import {
  findConfigProblem,
  SessionRiskConfig,
  TradingSession,
  TradingSessionConfig,
} from '@/domain/trading/tradingSession'
import { ExecutionEvent } from '@/domain/trading/strategyRunner'

// La API pública de la Fase 4 sigue residiendo aquí (re-export): la validación
// compartida vive ahora en el motor común de la Fase 5 (§7).
export {
  findConfigProblem,
  type ConfigProblem,
  type SessionRiskConfig,
  type TradingSessionConfig,
} from '@/domain/trading/tradingSession'

/** Config de backtest: la sesión compartida (§7) + registro y cierre (Fase 6). */
export interface BacktestConfig extends TradingSessionConfig {
  /** Instrumento registrado en el experimento (§12C); no interviene en la ejecución. */
  instrument?: Instrument
  /** Cierra la posición abierta al cierre de la última vela (por defecto `false`). */
  closePositionAtEnd?: boolean
}

/** Riesgo de un backtest **sin costes**: la fuente única es `execution`. */
export type BacktestRiskConfig = SessionRiskConfig

export interface BacktestResult {
  /** Un `Trade` por cierre (parcial o total); `Σ pnl = finalEquity − inicial` sin posición abierta. */
  trades: readonly Trade[]
  /** Equity marcado a mercado, un punto por cierre de vela. */
  equityCurve: readonly EquityPoint[]
  metrics: Metrics
  finalEquity: number
  /** Órdenes enviadas con su estado final. */
  orders: readonly Order[]
  /** Secuencia aplanada de eventos de ejecución (§12D), en orden. */
  events: readonly ExecutionEvent[]
  /** Config efectiva de ejecución (defaults resueltos) con la que corrió (§12C). */
  execution: Required<ExecutionModelConfig>
  /** Config efectiva de riesgo (defaults resueltos) con la que corrió (§12C). */
  risk: Required<RiskConfig>
}

export class BacktestError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('BacktestError', invalidMessage('Backtest inválido', reason, raw))
  }
}

/**
 * Ejecución automática sobre datos históricos (§7A): consume el motor
 * compartido `TradingSession` (Fase 5, §7 "compartir el motor de reproducción")
 * en un bucle hasta el final. La sesión ensambla el stack de la Fase 3
 * (`Portfolio + RiskManager + RecordingBroker + StrategyRunner + MarketClock`);
 * aquí solo se controla el tiempo (todas las velas, de golpe) y se presentan
 * los resultados. Determinista (§12C): misma config → mismo resultado, sin
 * `Date.now`.
 *
 * Orden anti look-ahead (heredado del runner): por vela, avance de mercado →
 * decisión → envío; la orden de la vela N rellena en N+1.
 *
 * El resultado incluye la config **efectiva** (defaults resueltos) leída de los
 * objetos construidos, no una segunda copia de los defaults.
 */
export function runBacktest(config: BacktestConfig): BacktestResult {
  const problem = findConfigProblem(config)
  if (problem !== null) {
    throw new BacktestError(problem.reason, problem.raw)
  }

  const session = new TradingSession(
    config,
    (inner, account) => new RecordingBroker(inner, account),
  )
  return buildResult(session, config)
}

/** Bucle automático (§7A): todas las velas de golpe; un punto de equity por cierre. */
function collectEquityCurve(
  session: TradingSession<RecordingBroker>,
  closePositionAtEnd: boolean,
): EquityPoint[] {
  const equityCurve: EquityPoint[] = []
  while (!session.finished) {
    const step = session.advance()
    // El cierre opcional se resuelve ANTES de muestrear el equity final.
    const closed = closePositionAtEnd && session.finished && closeOpenPosition(session, step.candle)
    equityCurve.push({
      time: step.candle.time,
      equity: closed ? session.portfolio.equity(step.candle.close) : step.equity,
    })
  }
  return equityCurve
}

/**
 * Cierre opcional (Fase 6, `closePositionAtEnd`): si queda posición abierta
 * al terminar el bucle, se vende al **cierre de la última vela** con los
 * mismos costes (slippage/fee) que el `ExecutionModel`. Es una excepción
 * deliberada al relleno "al siguiente open": no hay vela siguiente y la
 * decisión se toma después de ese cierre (sin look-ahead). No pasa por el
 * runner (sin `ExecutionEvent`), pero registra orden, fill y trade. Devuelve
 * `false` si no había posición abierta.
 */
function closeOpenPosition(session: TradingSession<RecordingBroker>, candle: Candle): boolean {
  const position = session.portfolio.position
  if (position === null || !position.isOpen) return false

  const { slippageBps, feeBps } = session.executionConfig
  // Misma fórmula que NextOpenExecutionModel: venta con sesgo contra el usuario.
  const price = withSlippage(candle.close, -slippageBps)
  const fee = feeFor(price * position.qty, feeBps)

  const order = new Order({
    id: 'close',
    side: OrderSide.Sell,
    type: OrderType.Market,
    qty: position.qty,
    createdAt: candle.time,
  })
  const fill = new Fill({
    orderId: order.id,
    side: OrderSide.Sell,
    price,
    qty: position.qty,
    fee,
    time: candle.time,
  })

  session.broker.submitOrder(order)
  session.broker.submitExternalFill(order, fill)
  return true
}

/** Presenta el resultado de la sesión: trades, curva, métricas y config efectiva. */
function buildResult(
  session: TradingSession<RecordingBroker>,
  config: BacktestConfig,
): BacktestResult {
  const { timeframe, initialCapital } = config
  const equityCurve = collectEquityCurve(session, config.closePositionAtEnd ?? false)

  const last = equityCurve[equityCurve.length - 1]
  if (last === undefined) {
    throw new BacktestError('la curva de equity quedó vacía', equityCurve.length)
  }

  const trades = session.broker.trades
  return {
    trades,
    equityCurve,
    metrics: computeMetrics({ trades, equityCurve, initialCapital, timeframe }),
    finalEquity: last.equity,
    orders: session.broker.orders,
    events: session.events,
    execution: session.executionConfig,
    risk: session.riskConfig,
  }
}
