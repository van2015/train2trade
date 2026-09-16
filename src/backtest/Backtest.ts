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
import { resample } from './Resample';
import { createContext, resolveStrategy, validTradeSpecs } from './Strategy';

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

function toTime(date: string): number {
  return new Date(date).getTime();
}

function entryFillReference(spec: TradeSpec, bar: PriceData): number | undefined {
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

export function runBacktest(input: BacktestInput): BacktestResult {
  const resolved = resolveStrategy(input.strategyId, input.params ?? {});
  const strategyTimeframe = input.strategyTimeframe ?? resolved.definition.timeframe;
  const { bars, hasFinerData } = resample(input.dataset, strategyTimeframe);

  const closedTrades: ClosedTrade[] = [];
  const invalidated: InvalidatedTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  if (bars.length === 0) {
    return { trades: closedTrades, invalidated, equityCurve, hasFinerData };
  }

  const broker = new Broker(input.platform, input.initialBalance);
  const trades = new Map<string, Trade>();
  const tradeSpecs = new Map<string, TradeSpec>();
  const tradeFees = new Map<string, FeeState>();
  const tradeOpenedAt = new Map<string, number>();
  const ruleState = new Map<string, RuleState>();
  const pendingEntries: PendingEntry[] = [];
  const pendingExits: PendingExit[] = [];

  let tradeCounter = 0;

  const unrealized = (price: number): number => {
    let total = 0;
    for (const trade of trades.values()) {
      const factor = trade.side === 'long' ? 1 : -1;
      total += (price - trade.averageEntry) * trade.size * factor;
    }
    return total;
  };

  const openFees = (): number => {
    let total = 0;
    for (const fee of tradeFees.values()) total += fee.entryRemaining;
    return total;
  };

  const equity = (price: number): number => broker.balance + unrealized(price) - openFees();

  const openTradeViews = () => [...trades.values()].map(trade => trade.toView());

  const openedSize = (trade: Trade): number =>
    trade.fills.reduce((sum, fill) => sum + fill.size, 0);

  const finalizeTrade = (trade: Trade, time: number): void => {
    const fees = tradeFees.get(trade.id);
    const totalFees = fees ? fees.entryTotal + fees.exitTotal : 0;
    const grossPnl = trade.realizedPnl;

    closedTrades.push({
      id: trade.id,
      side: trade.side,
      size: openedSize(trade),
      averageEntry: trade.averageEntry,
      initialStopLoss: trade.initialStopLoss,
      grossPnl,
      fees: totalFees,
      netPnl: grossPnl - totalFees,
      rMultiple: trade.rMultiple,
      openedAt: tradeOpenedAt.get(trade.id) ?? time,
      closedAt: time,
    });

    trades.delete(trade.id);
    tradeSpecs.delete(trade.id);
    tradeFees.delete(trade.id);
    tradeOpenedAt.delete(trade.id);
    ruleState.delete(trade.id);
  };

  const closeTrade = (trade: Trade, price: number, time: number): void => {
    const size = trade.size;
    const fees = tradeFees.get(trade.id);
    const entryPortion = fees ? fees.entryRemaining : 0;
    const exitFee = broker.commission(size);
    const before = trade.realizedPnl;

    trade.close(price);

    if (fees) {
      fees.entryRemaining -= entryPortion;
      fees.exitTotal += exitFee;
    }
    broker.releaseMargin(size, trade.averageEntry);
    broker.applyRealizedPnl(trade.realizedPnl - before - entryPortion - exitFee);

    finalizeTrade(trade, time);
  };

  const reduceTrade = (trade: Trade, portion: number, price: number, time: number): void => {
    const reduceSize = trade.size * portion;
    if (reduceSize <= 0) return;

    const fees = tradeFees.get(trade.id);
    const entryPortion = fees ? fees.entryRemaining * portion : 0;
    const exitFee = broker.commission(reduceSize);
    const before = trade.realizedPnl;

    trade.reduce(reduceSize, price);

    if (fees) {
      fees.entryRemaining -= entryPortion;
      fees.exitTotal += exitFee;
    }
    broker.releaseMargin(reduceSize, trade.averageEntry);
    broker.applyRealizedPnl(trade.realizedPnl - before - entryPortion - exitFee);

    if (trade.state === 'closed') {
      finalizeTrade(trade, time);
    }
  };

  const invalidateTrade = (trade: Trade, time: number, reason: string): void => {
    broker.releaseMargin(trade.size, trade.averageEntry);
    trades.delete(trade.id);
    tradeSpecs.delete(trade.id);
    tradeFees.delete(trade.id);
    tradeOpenedAt.delete(trade.id);
    ruleState.delete(trade.id);
    invalidated.push({ id: trade.id, side: trade.side, reason, at: time });
  };

  const fillEntry = (entry: PendingEntry, bar: PriceData, time: number): boolean => {
    const reference = entryFillReference(entry.spec, bar);
    if (reference === undefined) return false;

    const side = entry.spec.side === 'long' ? 'buy' : 'sell';
    const price = broker.alignToTick(
      broker.fillPrice(side, reference, entry.spec.order.type === 'market')
    );

    let size: number;
    try {
      size = broker.sizeFromRisk(entry.spec.risk.fraction, price, entry.spec.stopLoss, equity(price));
    } catch {
      return true;
    }
    if (size <= 0) return true;
    if (!broker.validateOrder({ price, size }).valid) return true;

    tradeCounter += 1;
    const id = `trade-${tradeCounter}`;
    const trade = new Trade(id, entry.spec.side);
    trade.addFill(size, price, time);
    if (entry.spec.stopLoss !== undefined) trade.setStopLoss(entry.spec.stopLoss);
    if (entry.spec.takeProfit !== undefined) trade.setTakeProfit(entry.spec.takeProfit);

    const entryFee = broker.commission(size);
    trades.set(id, trade);
    tradeSpecs.set(id, entry.spec);
    tradeFees.set(id, { entryTotal: entryFee, entryRemaining: entryFee, exitTotal: 0 });
    tradeOpenedAt.set(id, time);
    ruleState.set(id, {
      breakEvenDone: false,
      partialsTriggered: entry.spec.rules.map(() => false),
    });
    broker.addMargin(size, price);
    return true;
  };

  const unrealizedPnl = (trade: Trade, price: number): number => {
    const factor = trade.side === 'long' ? 1 : -1;
    return (price - trade.averageEntry) * trade.size * factor;
  };

  const evaluatePriceRules = (
    trade: Trade,
    spec: TradeSpec,
    bar: PriceData,
    time: number
  ): void => {
    if (trade.state !== 'open') return;
    const state = ruleState.get(trade.id);
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
          if (unrealizedPnl(trade, price) >= rule.rMultiple * risk) {
            trade.setStopLoss(trade.averageEntry);
            state.breakEvenDone = true;
          }
          break;
        }
        case 'partialTakeProfit': {
          if (state.partialsTriggered[index]) break;
          const risk = trade.riskAmount;
          if (risk === undefined) break;
          if (unrealizedPnl(trade, price) >= rule.rMultiple * risk) {
            reduceTrade(trade, rule.portion, price, time);
            state.partialsTriggered[index] = true;
          }
          break;
        }
        case 'closeWhen':
          break;
      }
    });
  };

  const evaluateProtective = (trade: Trade, bar: PriceData, time: number): void => {
    const long = trade.side === 'long';
    const stopLoss = trade.stopLoss;
    const takeProfit = trade.takeProfit;

    const hitStop = stopLoss !== undefined && (long ? bar.low <= stopLoss : bar.high >= stopLoss);
    const hitTarget =
      takeProfit !== undefined && (long ? bar.high >= takeProfit : bar.low <= takeProfit);

    if (!hitStop && !hitTarget) return;

    if (hitStop && hitTarget) {
      if (!hasFinerData) {
        invalidateTrade(trade, time, 'ambiguous bar without finer data');
        return;
      }
      closeTrade(trade, stopLoss as number, time);
      return;
    }

    closeTrade(trade, (hitStop ? stopLoss : takeProfit) as number, time);
  };

  const evaluateContextRules = (ctx: StrategyContext): void => {
    for (const [id, trade] of [...trades]) {
      const spec = tradeSpecs.get(id);
      if (!spec || trade.state !== 'open') continue;
      const shouldClose = spec.rules.some(
        rule => rule.kind === 'closeWhen' && rule.predicate(trade.toView(), ctx)
      );
      if (shouldClose) pendingExits.push({ tradeId: id, portion: 1 });
    }
  };

  for (let s = 0; s < bars.length; s++) {
    const bar = bars[s];
    const subBars = bar.subBars.length > 0 ? bar.subBars : [bar];

    for (const sub of subBars) {
      const time = toTime(sub.date);

      for (const exit of pendingExits.splice(0)) {
        const trade = trades.get(exit.tradeId);
        if (!trade) continue;
        const side = trade.side === 'long' ? 'sell' : 'buy';
        const price = broker.alignToTick(broker.fillPrice(side, sub.open, true));
        if (exit.portion >= 1) {
          closeTrade(trade, price, time);
        } else {
          reduceTrade(trade, exit.portion, price, time);
        }
      }

      for (const entry of [...pendingEntries]) {
        if (fillEntry(entry, sub, time)) {
          pendingEntries.splice(pendingEntries.indexOf(entry), 1);
        }
      }

      for (const trade of [...trades.values()]) {
        const spec = tradeSpecs.get(trade.id);
        if (spec) evaluatePriceRules(trade, spec, sub, time);
      }

      for (const trade of [...trades.values()]) {
        if (!trades.has(trade.id)) continue;
        evaluateProtective(trade, sub, time);
      }

      if (broker.isStopOut(equity(sub.close))) {
        for (const trade of [...trades.values()]) {
          closeTrade(trade, sub.close, time);
        }
      }
    }

    if (s < bars.length - 1) {
      const ctx = createContext(bars, s, openTradeViews());
      evaluateContextRules(ctx);
      const specs = validTradeSpecs(resolved.definition.onBar(ctx, resolved.params));
      for (const spec of specs) pendingEntries.push({ spec });
    }

    equityCurve.push({
      time: toTime(bar.date),
      balance: broker.balance,
      equity: equity(bar.close),
    });
  }

  return { trades: closedTrades, invalidated, equityCurve, hasFinerData };
}
