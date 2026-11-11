import { Trade } from '@/domain/backtest/trade'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { computeMetrics, EquityPoint, Metrics, MetricsInput } from '@/domain/backtest/metrics'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { DomainError, invalidMessage } from '@/domain/errors'
import { ExecutionModelConfig, NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { Order } from '@/domain/execution/order'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskConfig, RiskManager } from '@/domain/portfolio/riskManager'
import { Strategy } from '@/domain/strategies/strategy'
import { MarketClock } from '@/domain/time/marketClock'
import { ExecutionEvent, StrategyRunner } from '@/domain/trading/strategyRunner'

export interface BacktestConfig {
  strategy: Strategy
  /** Velas ascendentes y no vacías (se validan de forma incremental al recorrerlas). */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento (§12C). */
  timeframe: Timeframe
  initialCapital: number
  /** Slippage/fee del `ExecutionModel`; debe coincidir con el `risk` estimado. */
  execution?: ExecutionModelConfig
  risk?: RiskConfig
}

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
}

export class BacktestError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('BacktestError', invalidMessage('Backtest inválido', reason, raw))
  }
}

/**
 * Ejecución automática sobre datos históricos (§7A): ensambla el stack de la
 * Fase 3 (`Portfolio + RiskManager + HistoricalBroker + RecordingBroker +
 * StrategyRunner`) y recorre las velas cronológicamente con un `MarketClock`
 * (§12A). Determinista (§12C): misma config → mismo resultado, sin `Date.now`.
 *
 * Orden anti look-ahead (heredado del runner): por vela, avance de mercado →
 * decisión → envío; la orden de la vela N rellena en N+1.
 */
export function runBacktest(config: BacktestConfig): BacktestResult {
  const { strategy, candles, timeframe, initialCapital, execution, risk } = config

  if (candles.length === 0) {
    throw new BacktestError('se necesita al menos una vela', candles.length)
  }
  if (!(timeframe instanceof Timeframe)) {
    throw new BacktestError('timeframe debe ser un Timeframe', timeframe)
  }

  const portfolio = new Portfolio(initialCapital)
  const riskManager = new RiskManager(risk)
  const inner = new HistoricalBroker(portfolio, new NextOpenExecutionModel(execution))
  const broker = new RecordingBroker(inner, portfolio)
  const runner = new StrategyRunner(strategy, broker, portfolio, riskManager)
  const clock = new MarketClock()

  const equityCurve: EquityPoint[] = []
  const events: ExecutionEvent[] = []

  for (const [index, candle] of candles.entries()) {
    clock.advanceTo(candle.time)
    events.push(...runner.onCandle(candles.slice(0, index + 1)))
    equityCurve.push({ time: candle.time, equity: portfolio.equity(candle.close) })
  }

  const last = equityCurve[equityCurve.length - 1]
  if (last === undefined) {
    throw new BacktestError('la curva de equity quedó vacía', equityCurve.length)
  }

  const metricsInput: MetricsInput = {
    trades: broker.trades,
    equityCurve,
    initialCapital,
    timeframe,
  }

  return {
    trades: broker.trades,
    equityCurve,
    metrics: computeMetrics(metricsInput),
    finalEquity: last.equity,
    orders: broker.orders,
    events,
  }
}
