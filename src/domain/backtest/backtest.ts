import { computeMetrics, EquityPoint, Metrics } from '@/domain/backtest/metrics'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { Trade } from '@/domain/backtest/trade'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { ExecutionModelConfig } from '@/domain/execution/executionModel'
import { Order } from '@/domain/execution/order'
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

/** Config de backtest: misma forma que la sesión compartida (§7). */
export type BacktestConfig = TradingSessionConfig

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
  const { timeframe, initialCapital } = config

  const problem = findConfigProblem(config)
  if (problem !== null) {
    throw new BacktestError(problem.reason, problem.raw)
  }

  const session = new TradingSession(
    config,
    (inner, account) => new RecordingBroker(inner, account),
  )

  const equityCurve: EquityPoint[] = []
  while (!session.finished) {
    const step = session.advance()
    equityCurve.push({ time: step.candle.time, equity: step.equity })
  }

  const last = equityCurve[equityCurve.length - 1]
  if (last === undefined) {
    throw new BacktestError('la curva de equity quedó vacía', equityCurve.length)
  }

  return {
    trades: session.broker.trades,
    equityCurve,
    metrics: computeMetrics({
      trades: session.broker.trades,
      equityCurve,
      initialCapital,
      timeframe,
    }),
    finalEquity: last.equity,
    orders: session.broker.orders,
    events: session.events,
    execution: session.executionConfig,
    risk: session.riskConfig,
  }
}
