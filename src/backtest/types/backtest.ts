import { PriceData, IndicatorId, IndicatorSeries } from '../../shared/types/asset';
import { Timeframe } from '../timeframe/Timeframe';

export interface AggregatedBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  subBars: PriceData[];
}

export interface ResampleResult {
  strategyTimeframe: Timeframe;
  sourceTimeframe: Timeframe;
  bars: AggregatedBar[];
  subBars: PriceData[];
  hasFinerData: boolean;
}

export type Side = 'long' | 'short';

export type TradeState = 'pending' | 'open' | 'closed';

export interface Fill {
  size: number;
  price: number;
  time?: number;
}

export interface TradeView {
  id: string;
  side: Side;
  state: TradeState;
  size: number;
  averageEntry: number;
  stopLoss?: number;
  takeProfit?: number;
  realizedPnl: number;
  rMultiple?: number;
}

export type PriceSeriesName = 'open' | 'high' | 'low' | 'close' | 'volume';

export type OrderType = 'market' | 'limit' | 'stop';

export interface OrderSpec {
  type: OrderType;
  price?: number;
}

export interface RiskSpec {
  fraction: number;
}

export type TradeRule =
  | { kind: 'trailingStop'; distance: number }
  | { kind: 'breakEvenAtR'; rMultiple: number }
  | { kind: 'partialTakeProfit'; portion: number; rMultiple: number }
  | { kind: 'closeWhen'; predicate: TradePredicate };

export interface TradeSpec {
  side: Side;
  order: OrderSpec;
  risk: RiskSpec;
  stopLoss?: number;
  takeProfit?: number;
  tag?: string;
  rules: TradeRule[];
}

export interface StrategyContext {
  readonly index: number;
  readonly time: number;
  candle(): PriceData;
  series(name: PriceSeriesName): (number | undefined)[];
  indicator(indicatorId: IndicatorId, params?: Record<string, number>): IndicatorSeries[];
  trades(): readonly TradeView[];
}

export type TradePredicate = (trade: TradeView, ctx: StrategyContext) => boolean;

export interface StrategyParameterSpec {
  key: string;
  label: string;
  default: number;
  min?: number;
}

export interface StrategyDefinition {
  id: string;
  label: string;
  timeframe: Timeframe;
  params: StrategyParameterSpec[];
  onBar: (ctx: StrategyContext, params: Record<string, number>) => TradeSpec[];
}

export interface ResolvedStrategy {
  definition: StrategyDefinition;
  params: Record<string, number>;
}

export interface PlatformConfig {
  contractSize: number;
  minLot: number;
  lotStep: number;
  tickSize: number;
  leverage: number;
  commissionPerLot: number;
  spread: number;
  slippage: number;
  stopOutLevel: number;
}

export type OrderSide = 'buy' | 'sell';

export interface OrderValidation {
  valid: boolean;
  reason?: string;
}

export interface OrderValidationInput {
  price?: number;
  size: number;
}

export interface BacktestInput {
  dataset: PriceData[];
  strategyId: string;
  params?: Record<string, number>;
  platform: PlatformConfig;
  initialBalance: number;
  strategyTimeframe?: Timeframe;
}

export interface ClosedTrade {
  id: string;
  side: Side;
  size: number;
  averageEntry: number;
  initialStopLoss?: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  rMultiple?: number;
  openedAt: number;
  closedAt: number;
}

export interface InvalidatedTrade {
  id: string;
  side: Side;
  reason: string;
  at: number;
}

export interface EquityPoint {
  time: number;
  balance: number;
  equity: number;
}

export interface BacktestResult {
  trades: ClosedTrade[];
  invalidated: InvalidatedTrade[];
  equityCurve: EquityPoint[];
  hasFinerData: boolean;
}

export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  costs: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  averageR?: number;
  invalidatedCount: number;
  invalidatedRatio: number;
}
