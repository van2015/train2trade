import { PriceData } from '../../shared/types/asset';
import {
  BacktestInput,
  BacktestResult,
  ClosedTrade,
  EquityPoint,
  InvalidatedTrade,
  StrategyContext,
  TradeSpec,
} from '../../backtest/types/backtest';
import { Trade } from '../models/Trade';
import { Broker } from '../services/Broker';
import { DataResampler } from './Resampler';
import { StrategyManager } from '../services/StrategyManager';
import { AggregatedBar } from '../../backtest/types/backtest';
import { TradeState, Side } from '../types/TradeEnums';

interface PendingEntry {
  spec: TradeSpec;
}

interface PendingExit {
  tradeId: string;
  portion: number;
}

interface RuleState {
  breakEvenDone: boolean;
  partialsTriggered: boolean[];
}

interface FeeState {
  entryTotal: number;
  entryRemaining: number;
  exitTotal: number;
}

export class BacktestEngine {
  private closedTrades: ClosedTrade[] = [];
  private invalidated: InvalidatedTrade[] = [];
  private equityCurve: EquityPoint[] = [];
  private broker!: Broker;
  private trades = new Map<string, Trade>();
  private tradeSpecs = new Map<string, TradeSpec>();
  private tradeFees = new Map<string, FeeState>();
  private tradeOpenedAt = new Map<string, number>();
  private ruleState = new Map<string, RuleState>();
  private pendingEntries: PendingEntry[] = [];
  private pendingExits: PendingExit[] = [];
  private tradeCounter = 0;
  private hasFinerData = false;
  private allBars: AggregatedBar[] = [];

  private toTime(date: string): number {
    return new Date(date).getTime();
  }

  private entryFillReference(spec: TradeSpec, bar: PriceData): number | undefined {
    const { order, side } = spec;

    if (order.type === 'market') return bar.open;
    if (order.price === undefined) return undefined;

    if (order.type === 'limit') {
      if (side === Side.Long) return bar.low <= order.price ? Math.min(bar.open, order.price) : undefined;
      return bar.high >= order.price ? Math.max(bar.open, order.price) : undefined;
    }

    if (side === Side.Long) return bar.high >= order.price ? Math.max(bar.open, order.price) : undefined;
    return bar.low <= order.price ? Math.min(bar.open, order.price) : undefined;
  }

  run(input: BacktestInput): BacktestResult {
    const strategyManager = StrategyManager.getInstance();
    const resolved = strategyManager.resolveStrategy(input.strategyId, input.params ?? {});
    const strategyTimeframe = input.strategyTimeframe ?? resolved.definition.timeframe;
    const resampler = new DataResampler();
    const { bars, hasFinerData } = resampler.resample(input.dataset, strategyTimeframe);
    this.hasFinerData = hasFinerData;
    this.allBars = bars;

    this.closedTrades = [];
    this.invalidated = [];
    this.equityCurve = [];

    if (bars.length === 0) {
      return { trades: this.closedTrades, invalidated: this.invalidated, equityCurve: this.equityCurve, hasFinerData };
    }

    this.broker = new Broker(input.platform, input.initialBalance);
    this.initializeState();

    for (let s = 0; s < bars.length; s++) {
      this.processBar(bars[s], s, bars.length, resolved, strategyManager);
    }

    return { trades: this.closedTrades, invalidated: this.invalidated, equityCurve: this.equityCurve, hasFinerData };
  }

  private initializeState(): void {
    this.trades.clear();
    this.tradeSpecs.clear();
    this.tradeFees.clear();
    this.tradeOpenedAt.clear();
    this.ruleState.clear();
    this.pendingEntries = [];
    this.pendingExits = [];
    this.tradeCounter = 0;
  }

  private processBar(
    bar: AggregatedBar,
    index: number,
    totalBars: number,
    resolved: { definition: { onBar: (ctx: StrategyContext, params: Record<string, number>) => TradeSpec[] }; params: Record<string, number> },
    strategyManager: StrategyManager
  ): void {
    const subBars = bar.subBars.length > 0 ? bar.subBars : [bar];

    for (const sub of subBars) {
      const time = this.toTime(sub.date);
      this.processPendingExits(time, sub);
      this.processPendingEntries(sub, time);
      this.evaluateTradeRules(sub, time);
      this.evaluateProtectiveTrades(sub, time);
      this.checkStopOut(sub.close, time);
    }

    if (index < totalBars - 1) {
      this.generateNewSignals(bar, index, resolved, strategyManager);
    }

    this.updateEquityCurve(bar);
  }

  private processPendingExits(time: number, sub: PriceData): void {
    for (const exit of this.pendingExits.splice(0)) {
      const trade = this.trades.get(exit.tradeId);
      if (!trade) continue;
      const side = trade.side === Side.Long ? 'sell' : 'buy';
      const price = this.broker.alignToTick(this.broker.fillPrice(side, sub.open, true));
      if (exit.portion >= 1) {
        this.closeTrade(trade, price, time);
      } else {
        this.reduceTrade(trade, exit.portion, price, time);
      }
    }
  }

  private processPendingEntries(sub: PriceData, time: number): void {
    for (const entry of [...this.pendingEntries]) {
      if (this.fillEntry(entry, sub, time)) {
        this.pendingEntries.splice(this.pendingEntries.indexOf(entry), 1);
      }
    }
  }

  private evaluateTradeRules(sub: PriceData, time: number): void {
    for (const trade of [...this.trades.values()]) {
      const spec = this.tradeSpecs.get(trade.id);
      if (spec) this.evaluatePriceRules(trade, spec, sub, time);
    }

    for (const trade of [...this.trades.values()]) {
      if (!this.trades.has(trade.id)) continue;
      this.evaluateProtective(trade, sub, time);
    }
  }

  private evaluateProtectiveTrades(_sub: PriceData, _time: number): void {
  }

  private checkStopOut(closePrice: number, time: number): void {
    if (this.broker.isStopOut(this.equity(closePrice))) {
      for (const trade of [...this.trades.values()]) {
        this.closeTrade(trade, closePrice, time);
      }
    }
  }

  private generateNewSignals(
    bar: AggregatedBar,
    index: number,
    resolved: { definition: { onBar: (ctx: StrategyContext, params: Record<string, number>) => TradeSpec[] }; params: Record<string, number> },
    strategyManager: StrategyManager
  ): void {
    const bars = this.collectBarsUpToIndex(bar, index);
    const ctx = strategyManager.createContext(bars, index, this.openTradeViews());
    this.evaluateContextRules(ctx);
    const specs = strategyManager.validTradeSpecs(resolved.definition.onBar(ctx, resolved.params));
    for (const spec of specs) this.pendingEntries.push({ spec });
  }

  private collectBarsUpToIndex(_currentBar: AggregatedBar, index: number): PriceData[] {
    return this.allBars.slice(0, index + 1);
  }

  private updateEquityCurve(bar: AggregatedBar): void {
    this.equityCurve.push({
      time: this.toTime(bar.date),
      balance: this.broker.balance,
      equity: this.equity(bar.close),
    });
  }

  private unrealized(price: number): number {
    let total = 0;
    for (const trade of this.trades.values()) {
      const factor = trade.side === Side.Long ? 1 : -1;
      total += (price - trade.averageEntry) * trade.size * factor;
    }
    return total;
  }

  private openFees(): number {
    let total = 0;
    for (const fee of this.tradeFees.values()) total += fee.entryRemaining;
    return total;
  }

  private equity(price: number): number {
    return this.broker.balance + this.unrealized(price) - this.openFees();
  }

  private openTradeViews() {
    return [...this.trades.values()].map(trade => trade.toView());
  }

  private openedSize(trade: Trade): number {
    return trade.fills.reduce((sum, fill) => sum + fill.size, 0);
  }

  private finalizeTrade(trade: Trade, time: number): void {
    const fees = this.tradeFees.get(trade.id);
    const totalFees = fees ? fees.entryTotal + fees.exitTotal : 0;
    const grossPnl = trade.realizedPnl;

    this.closedTrades.push({
      id: trade.id,
      side: trade.side,
      size: this.openedSize(trade),
      averageEntry: trade.averageEntry,
      initialStopLoss: trade.initialStopLoss,
      grossPnl,
      fees: totalFees,
      netPnl: grossPnl - totalFees,
      rMultiple: trade.rMultiple,
      openedAt: this.tradeOpenedAt.get(trade.id) ?? time,
      closedAt: time,
    });

    this.trades.delete(trade.id);
    this.tradeSpecs.delete(trade.id);
    this.tradeFees.delete(trade.id);
    this.tradeOpenedAt.delete(trade.id);
    this.ruleState.delete(trade.id);
  }

  private closeTrade(trade: Trade, price: number, time: number): void {
    const size = trade.size;
    const fees = this.tradeFees.get(trade.id);
    const entryPortion = fees ? fees.entryRemaining : 0;
    const exitFee = this.broker.commission(size);
    const before = trade.realizedPnl;

    trade.close(price);

    if (fees) {
      fees.entryRemaining -= entryPortion;
      fees.exitTotal += exitFee;
    }
    this.broker.releaseMargin(size, trade.averageEntry);
    this.broker.applyRealizedPnl(trade.realizedPnl - before - entryPortion - exitFee);

    this.finalizeTrade(trade, time);
  }

  private reduceTrade(trade: Trade, portion: number, price: number, time: number): void {
    const reduceSize = trade.size * portion;
    if (reduceSize <= 0) return;

    const fees = this.tradeFees.get(trade.id);
    const entryPortion = fees ? fees.entryRemaining * portion : 0;
    const exitFee = this.broker.commission(reduceSize);
    const before = trade.realizedPnl;

    trade.reduce(reduceSize, price);

    if (fees) {
      fees.entryRemaining -= entryPortion;
      fees.exitTotal += exitFee;
    }
    this.broker.releaseMargin(reduceSize, trade.averageEntry);
    this.broker.applyRealizedPnl(trade.realizedPnl - before - entryPortion - exitFee);

    if (trade.state === TradeState.Closed) {
      this.finalizeTrade(trade, time);
    }
  }

  private invalidateTrade(trade: Trade, time: number, reason: string): void {
    this.broker.releaseMargin(trade.size, trade.averageEntry);
    this.trades.delete(trade.id);
    this.tradeSpecs.delete(trade.id);
    this.tradeFees.delete(trade.id);
    this.tradeOpenedAt.delete(trade.id);
    this.ruleState.delete(trade.id);
    this.invalidated.push({ id: trade.id, side: trade.side, reason, at: time });
  }

  private fillEntry(entry: PendingEntry, bar: PriceData, time: number): boolean {
    const reference = this.entryFillReference(entry.spec, bar);
    if (reference === undefined) return false;

    const side = entry.spec.side === Side.Long ? 'buy' : 'sell';
    const price = this.broker.alignToTick(
      this.broker.fillPrice(side, reference, entry.spec.order.type === 'market')
    );

    const sizeResult = this.calculatePositionSize(entry, price);
    if (sizeResult.skip) return true;
    if (sizeResult.size === undefined) return true;
    const size = sizeResult.size;

    if (!this.broker.validateOrder({ price, size }).valid) return true;

    const { id } = this.createTradeFromSpec(entry, size, price, time);
    this.initializeTradeState(id, entry, size, time);
    this.broker.addMargin(size, price);
    return true;
  }

  private calculatePositionSize(entry: PendingEntry, price: number): { size?: number; skip: boolean } {
    try {
      const size = this.broker.sizeFromRisk(entry.spec.risk.fraction, price, entry.spec.stopLoss, this.equity(price));
      if (size <= 0) return { skip: true };
      return { size, skip: false };
    } catch {
      return { skip: true };
    }
  }

  private createTradeFromSpec(entry: PendingEntry, size: number, price: number, time: number): { id: string; trade: Trade } {
    this.tradeCounter += 1;
    const id = `trade-${this.tradeCounter}`;
    const trade = new Trade(id, entry.spec.side);
    trade.addFill(size, price, time);
    if (entry.spec.stopLoss !== undefined) trade.setStopLoss(entry.spec.stopLoss);
    if (entry.spec.takeProfit !== undefined) trade.setTakeProfit(entry.spec.takeProfit);
    this.trades.set(id, trade);
    return { id, trade };
  }

  private initializeTradeState(id: string, entry: PendingEntry, size: number, time: number): void {
    const entryFee = this.broker.commission(size);
    this.tradeSpecs.set(id, entry.spec);
    this.tradeFees.set(id, { entryTotal: entryFee, entryRemaining: entryFee, exitTotal: 0 });
    this.tradeOpenedAt.set(id, time);
    this.ruleState.set(id, {
      breakEvenDone: false,
      partialsTriggered: entry.spec.rules.map(() => false),
    });
  }

  private unrealizedPnl(trade: Trade, price: number): number {
    const factor = trade.side === Side.Long ? 1 : -1;
    return (price - trade.averageEntry) * trade.size * factor;
  }

  private evaluatePriceRules(
    trade: Trade,
    spec: TradeSpec,
    bar: PriceData,
    time: number
  ): void {
    if (trade.state !== TradeState.Open) return;
    const state = this.ruleState.get(trade.id);
    if (!state) return;
    const price = bar.close;

    spec.rules.forEach((rule, index) => {
      if (trade.state !== TradeState.Open) return;

      switch (rule.kind) {
        case 'trailingStop': {
          this.evaluateTrailingStop(trade, price, rule.distance);
          break;
        }
        case 'breakEvenAtR': {
          this.evaluateBreakEvenAtR(trade, price, rule.rMultiple, state);
          break;
        }
        case 'partialTakeProfit': {
          this.evaluatePartialTakeProfit(trade, price, rule.portion, rule.rMultiple, index, state, time);
          break;
        }
        case 'closeWhen':
          break;
      }
    });
  }

  private evaluateTrailingStop(trade: Trade, price: number, distance: number): void {
    const next = trade.side === Side.Long ? price - distance : price + distance;
    const current = trade.stopLoss;
    if (trade.side === Side.Long) {
      if (current === undefined || next > current) trade.setStopLoss(next);
    } else if (current === undefined || next < current) {
      trade.setStopLoss(next);
    }
  }

  private evaluateBreakEvenAtR(trade: Trade, price: number, rMultiple: number, state: RuleState): void {
    if (state.breakEvenDone) return;
    const risk = trade.riskAmount;
    if (risk === undefined) return;
    if (this.unrealizedPnl(trade, price) >= rMultiple * risk) {
      trade.setStopLoss(trade.averageEntry);
      state.breakEvenDone = true;
    }
  }

  private evaluatePartialTakeProfit(
    trade: Trade,
    price: number,
    portion: number,
    rMultiple: number,
    index: number,
    state: RuleState,
    time: number
  ): void {
    if (state.partialsTriggered[index]) return;
    const risk = trade.riskAmount;
    if (risk === undefined) return;
    if (this.unrealizedPnl(trade, price) >= rMultiple * risk) {
      this.reduceTrade(trade, portion, price, time);
      state.partialsTriggered[index] = true;
    }
  }

  private evaluateProtective(trade: Trade, bar: PriceData, time: number): void {
    const long = trade.side === Side.Long;
    const stopLoss = trade.stopLoss;
    const takeProfit = trade.takeProfit;

    const hitStop = stopLoss !== undefined && (long ? bar.low <= stopLoss : bar.high >= stopLoss);
    const hitTarget =
      takeProfit !== undefined && (long ? bar.high >= takeProfit : bar.low <= takeProfit);

    if (!hitStop && !hitTarget) return;

    if (hitStop && hitTarget) {
      if (!this.hasFinerData) {
        this.invalidateTrade(trade, time, 'ambiguous bar without finer data');
        return;
      }
      this.closeTrade(trade, stopLoss as number, time);
      return;
    }

    this.closeTrade(trade, (hitStop ? stopLoss : takeProfit) as number, time);
  }

  private evaluateContextRules(ctx: StrategyContext): void {
    for (const [id, trade] of [...this.trades]) {
      const spec = this.tradeSpecs.get(id);
      if (!spec || trade.state !== TradeState.Open) continue;
      const shouldClose = spec.rules.some(
        rule => rule.kind === 'closeWhen' && rule.predicate(trade.toView(), ctx)
      );
      if (shouldClose) this.pendingExits.push({ tradeId: id, portion: 1 });
    }
  }
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const engine = new BacktestEngine();
  return engine.run(input);
}
