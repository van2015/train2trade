import { PriceData } from '../types/asset';
import {
  BacktestInput,
  BacktestResult,
  ClosedTrade,
  EquityPoint,
  InvalidatedTrade,
  StrategyContext,
  TradeSpec,
} from '../types/backtest';
import { Trade } from './Trade';
import { Broker } from './Broker';
import { DataResampler } from './Resample';
import { StrategyManager } from './Strategy';

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

  private toTime(date: string): number {
    return new Date(date).getTime();
  }

  private entryFillReference(spec: TradeSpec, bar: PriceData): number | undefined {
    const { order, side } = spec;

    if (order.type === 'market') return bar.open;
    if (order.price === undefined) return undefined;

    if (order.type === 'limit') {
      if (side === 'long') return bar.low <= order.price ? Math.min(bar.open, order.price) : undefined;
      return bar.high >= order.price ? Math.max(bar.open, order.price) : undefined;
    }

    if (side === 'long') return bar.high >= order.price ? Math.max(bar.open, order.price) : undefined;
    return bar.low <= order.price ? Math.min(bar.open, order.price) : undefined;
  }

  run(input: BacktestInput): BacktestResult {
    const strategyManager = StrategyManager.getInstance();
    const resolved = strategyManager.resolveStrategy(input.strategyId, input.params ?? {});
    const strategyTimeframe = input.strategyTimeframe ?? resolved.definition.timeframe;
    const resampler = new DataResampler();
    const { bars, hasFinerData } = resampler.resample(input.dataset, strategyTimeframe);
    this.hasFinerData = hasFinerData;

    this.closedTrades = [];
    this.invalidated = [];
    this.equityCurve = [];

    if (bars.length === 0) {
      return { trades: this.closedTrades, invalidated: this.invalidated, equityCurve: this.equityCurve, hasFinerData };
    }

    this.broker = new Broker(input.platform, input.initialBalance);
    this.trades.clear();
    this.tradeSpecs.clear();
    this.tradeFees.clear();
    this.tradeOpenedAt.clear();
    this.ruleState.clear();
    this.pendingEntries = [];
    this.pendingExits = [];
    this.tradeCounter = 0;

    for (let s = 0; s < bars.length; s++) {
      const bar = bars[s];
      const subBars = bar.subBars.length > 0 ? bar.subBars : [bar];

      for (const sub of subBars) {
        const time = this.toTime(sub.date);

        for (const exit of this.pendingExits.splice(0)) {
          const trade = this.trades.get(exit.tradeId);
          if (!trade) continue;
          const side = trade.side === 'long' ? 'sell' : 'buy';
          const price = this.broker.alignToTick(this.broker.fillPrice(side, sub.open, true));
          if (exit.portion >= 1) {
            this.closeTrade(trade, price, time);
          } else {
            this.reduceTrade(trade, exit.portion, price, time);
          }
        }

        for (const entry of [...this.pendingEntries]) {
          if (this.fillEntry(entry, sub, time)) {
            this.pendingEntries.splice(this.pendingEntries.indexOf(entry), 1);
          }
        }

        for (const trade of [...this.trades.values()]) {
          const spec = this.tradeSpecs.get(trade.id);
          if (spec) this.evaluatePriceRules(trade, spec, sub, time);
        }

        for (const trade of [...this.trades.values()]) {
          if (!this.trades.has(trade.id)) continue;
          this.evaluateProtective(trade, sub, time);
        }

        if (this.broker.isStopOut(this.equity(sub.close))) {
          for (const trade of [...this.trades.values()]) {
            this.closeTrade(trade, sub.close, time);
          }
        }
      }

      if (s < bars.length - 1) {
        const ctx = strategyManager.createContext(bars, s, this.openTradeViews());
        this.evaluateContextRules(ctx);
        const specs = strategyManager.validTradeSpecs(resolved.definition.onBar(ctx, resolved.params));
        for (const spec of specs) this.pendingEntries.push({ spec });
      }

      this.equityCurve.push({
        time: this.toTime(bar.date),
        balance: this.broker.balance,
        equity: this.equity(bar.close),
      });
    }

    return { trades: this.closedTrades, invalidated: this.invalidated, equityCurve: this.equityCurve, hasFinerData };
  }

  private unrealized(price: number): number {
    let total = 0;
    for (const trade of this.trades.values()) {
      const factor = trade.side === 'long' ? 1 : -1;
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

    if (trade.state === 'closed') {
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

    const side = entry.spec.side === 'long' ? 'buy' : 'sell';
    const price = this.broker.alignToTick(
      this.broker.fillPrice(side, reference, entry.spec.order.type === 'market')
    );

    let size: number;
    try {
      size = this.broker.sizeFromRisk(entry.spec.risk.fraction, price, entry.spec.stopLoss, this.equity(price));
    } catch {
      return true;
    }
    if (size <= 0) return true;
    if (!this.broker.validateOrder({ price, size }).valid) return true;

    this.tradeCounter += 1;
    const id = `trade-${this.tradeCounter}`;
    const trade = new Trade(id, entry.spec.side);
    trade.addFill(size, price, time);
    if (entry.spec.stopLoss !== undefined) trade.setStopLoss(entry.spec.stopLoss);
    if (entry.spec.takeProfit !== undefined) trade.setTakeProfit(entry.spec.takeProfit);

    const entryFee = this.broker.commission(size);
    this.trades.set(id, trade);
    this.tradeSpecs.set(id, entry.spec);
    this.tradeFees.set(id, { entryTotal: entryFee, entryRemaining: entryFee, exitTotal: 0 });
    this.tradeOpenedAt.set(id, time);
    this.ruleState.set(id, {
      breakEvenDone: false,
      partialsTriggered: entry.spec.rules.map(() => false),
    });
    this.broker.addMargin(size, price);
    return true;
  }

  private unrealizedPnl(trade: Trade, price: number): number {
    const factor = trade.side === 'long' ? 1 : -1;
    return (price - trade.averageEntry) * trade.size * factor;
  }

  private evaluatePriceRules(
    trade: Trade,
    spec: TradeSpec,
    bar: PriceData,
    time: number
  ): void {
    if (trade.state !== 'open') return;
    const state = this.ruleState.get(trade.id);
    if (!state) return;
    const price = bar.close;

    spec.rules.forEach((rule, index) => {
      if (trade.state !== 'open') return;

      switch (rule.kind) {
        case 'trailingStop': {
          const next = trade.side === 'long' ? price - rule.distance : price + rule.distance;
          const current = trade.stopLoss;
          if (trade.side === 'long') {
            if (current === undefined || next > current) trade.setStopLoss(next);
          } else if (current === undefined || next < current) {
            trade.setStopLoss(next);
          }
          break;
        }
        case 'breakEvenAtR': {
          if (state.breakEvenDone) break;
          const risk = trade.riskAmount;
          if (risk === undefined) break;
          if (this.unrealizedPnl(trade, price) >= rule.rMultiple * risk) {
            trade.setStopLoss(trade.averageEntry);
            state.breakEvenDone = true;
          }
          break;
        }
        case 'partialTakeProfit': {
          if (state.partialsTriggered[index]) break;
          const risk = trade.riskAmount;
          if (risk === undefined) break;
          if (this.unrealizedPnl(trade, price) >= rule.rMultiple * risk) {
            this.reduceTrade(trade, rule.portion, price, time);
            state.partialsTriggered[index] = true;
          }
          break;
        }
        case 'closeWhen':
          break;
      }
    });
  }

  private evaluateProtective(trade: Trade, bar: PriceData, time: number): void {
    const long = trade.side === 'long';
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
      if (!spec || trade.state !== 'open') continue;
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
