import { Trade } from '@/domain/backtest/trade'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { computeMetrics, EquityPoint, Metrics } from '@/domain/backtest/metrics'
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

/**
 * Riesgo de un backtest **sin costes**: `feeBps`/`slippageBps` no se aceptan
 * aquí porque la fuente única es `execution` (§: "debe coincidir con el
 * ExecutionModel"). `runBacktest` los deriva del modelo construido.
 */
export type BacktestRiskConfig = Omit<RiskConfig, 'feeBps' | 'slippageBps'>

export interface BacktestConfig {
  strategy: Strategy
  /** Velas ascendentes y no vacías (se validan de forma incremental al recorrerlas). */
  candles: readonly Candle[]
  /** Para la anualización del Sharpe y el registro del experimento (§12C). */
  timeframe: Timeframe
  initialCapital: number
  /** Slippage/fee: fuente única de costes; el `risk` estimado se deriva de aquí. */
  execution?: ExecutionModelConfig
  risk?: BacktestRiskConfig
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

/** Problema de configuración detectado antes de ejecutar. */
export interface ConfigProblem {
  reason: string
  raw: unknown
}

/**
 * Reglas de validación de `BacktestConfig`: **fuente única** compartida por
 * `runBacktest` (que la traduce a `BacktestError`) y `Experiment.run` (a
 * `ExperimentError`), para no duplicar los checks en dos módulos.
 */
export function findConfigProblem(config: BacktestConfig): ConfigProblem | null {
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

/**
 * Ejecución automática sobre datos históricos (§7A): ensambla el stack de la
 * Fase 3 (`Portfolio + RiskManager + HistoricalBroker + RecordingBroker +
 * StrategyRunner`) y recorre las velas cronológicamente con un `MarketClock`
 * (§12A). Determinista (§12C): misma config → mismo resultado, sin `Date.now`.
 *
 * Orden anti look-ahead (heredado del runner): por vela, avance de mercado →
 * decisión → envío; la orden de la vela N rellena en N+1.
 *
 * El resultado incluye la config **efectiva** (defaults resueltos) leída de los
 * objetos construidos, no una segunda copia de los defaults.
 */
export function runBacktest(config: BacktestConfig): BacktestResult {
  const { strategy, candles, timeframe, initialCapital, execution, risk } = config

  const problem = findConfigProblem(config)
  if (problem !== null) {
    throw new BacktestError(problem.reason, problem.raw)
  }

  const portfolio = new Portfolio(initialCapital)
  const executionModel = new NextOpenExecutionModel(execution)
  // Costes estimados := costes reales (fuente única: `execution`).
  const riskManager = new RiskManager({ ...risk, ...executionModel.config })
  const broker = new RecordingBroker(new HistoricalBroker(portfolio, executionModel), portfolio)
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

  return {
    trades: broker.trades,
    equityCurve,
    metrics: computeMetrics({ trades: broker.trades, equityCurve, initialCapital, timeframe }),
    finalEquity: last.equity,
    orders: broker.orders,
    events,
    execution: executionModel.config,
    risk: riskManager.config,
  }
}
