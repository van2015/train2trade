import { PriceData } from '../types/asset';
import {
  BacktestInput,
  BacktestResult,
  ClosedTrade,
  EquityPoint,
  InvalidatedTrade,
  OrderType,
  PositionView,
  Side,
  Signal,
} from '../types/backtest';
import { Position } from './Position';
import { Broker } from './Broker';
import { resample } from './Resample';
import { createContext, resolveStrategy, validSignals } from './Strategy';

interface PendingEntry {
  id: string;
  side: Side;
  orderType: OrderType;
  price?: number;
  riskFraction: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface PendingExit {
  positionId: string;
  portion: number;
}

function toTime(date: string): number {
  return new Date(date).getTime();
}

function entryFillReference(entry: PendingEntry, bar: PriceData): number | undefined {
  const { orderType, price, side } = entry;

  if (orderType === 'market') return bar.open;
  if (price === undefined) return undefined;

  if (orderType === 'limit') {
    if (side === 'long') return bar.low <= price ? Math.min(bar.open, price) : undefined;
    return bar.high >= price ? Math.max(bar.open, price) : undefined;
  }

  if (side === 'long') return bar.high >= price ? Math.max(bar.open, price) : undefined;
  return bar.low <= price ? Math.min(bar.open, price) : undefined;
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
  const positions = new Map<string, Position>();
  const positionFees = new Map<string, number>();
  const positionOpenedAt = new Map<string, number>();
  const pendingEntries: PendingEntry[] = [];
  const pendingExits: PendingExit[] = [];

  let positionCounter = 0;
  let orderCounter = 0;

  const unrealized = (price: number): number => {
    let total = 0;
    for (const position of positions.values()) {
      const factor = position.side === 'long' ? 1 : -1;
      total += (price - position.averageEntry) * position.size * factor;
    }
    return total;
  };

  const openFees = (): number => {
    let total = 0;
    for (const fee of positionFees.values()) total += fee;
    return total;
  };

  const equity = (price: number): number => broker.balance + unrealized(price) - openFees();

  const openPositionViews = (): PositionView[] =>
    [...positions.values()].map(position => position.toView());

  const closePosition = (position: Position, price: number, time: number): void => {
    const size = position.size;
    const entryPrice = position.averageEntry;
    const entryFee = positionFees.get(position.id) ?? 0;
    const exitFee = broker.commission(size);

    position.close(price);

    const grossPnl = position.realizedPnl;
    const fees = entryFee + exitFee;
    const netPnl = grossPnl - fees;

    broker.releaseMargin(size, entryPrice);
    broker.applyRealizedPnl(netPnl);

    closedTrades.push({
      id: position.id,
      side: position.side,
      size,
      averageEntry: entryPrice,
      initialStopLoss: position.initialStopLoss,
      grossPnl,
      fees,
      netPnl,
      rMultiple: position.rMultiple,
      openedAt: positionOpenedAt.get(position.id) ?? time,
      closedAt: time,
    });

    positions.delete(position.id);
    positionFees.delete(position.id);
    positionOpenedAt.delete(position.id);
  };

  const invalidatePosition = (position: Position, time: number, reason: string): void => {
    broker.releaseMargin(position.size, position.averageEntry);
    positions.delete(position.id);
    positionFees.delete(position.id);
    positionOpenedAt.delete(position.id);
    invalidated.push({ id: position.id, side: position.side, reason, at: time });
  };

  const reducePosition = (position: Position, portion: number, price: number): void => {
    const reduceSize = position.size * portion;
    if (reduceSize <= 0) return;

    const entryFeePortion = (positionFees.get(position.id) ?? 0) * portion;
    const exitFee = broker.commission(reduceSize);
    const before = position.realizedPnl;

    position.reduce(reduceSize, price);

    const delta = position.realizedPnl - before;
    broker.releaseMargin(reduceSize, position.averageEntry);
    broker.applyRealizedPnl(delta - entryFeePortion - exitFee);
    positionFees.set(position.id, (positionFees.get(position.id) ?? 0) - entryFeePortion);
  };

  const fillEntry = (entry: PendingEntry, bar: PriceData, time: number): boolean => {
    const reference = entryFillReference(entry, bar);
    if (reference === undefined) return false;

    const side = entry.side === 'long' ? 'buy' : 'sell';
    const price = broker.alignToTick(
      broker.fillPrice(side, reference, entry.orderType === 'market')
    );

    let size: number;
    try {
      size = broker.sizeFromRisk(entry.riskFraction, price, entry.stopLoss, equity(price));
    } catch {
      return true;
    }
    if (size <= 0) return true;
    if (!broker.validateOrder({ price, size }).valid) return true;

    positionCounter += 1;
    const id = `pos-${positionCounter}`;
    const position = new Position(id, entry.side);
    position.addFill(size, price, time);
    if (entry.stopLoss !== undefined) position.setStopLoss(entry.stopLoss);
    if (entry.takeProfit !== undefined) position.setTakeProfit(entry.takeProfit);

    positions.set(id, position);
    positionFees.set(id, broker.commission(size));
    positionOpenedAt.set(id, time);
    broker.addMargin(size, price);
    return true;
  };

  const evaluateProtective = (position: Position, bar: PriceData, time: number): void => {
    const long = position.side === 'long';
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    const hitStop =
      stopLoss !== undefined && (long ? bar.low <= stopLoss : bar.high >= stopLoss);
    const hitTarget =
      takeProfit !== undefined && (long ? bar.high >= takeProfit : bar.low <= takeProfit);

    if (!hitStop && !hitTarget) return;

    if (hitStop && hitTarget) {
      if (!hasFinerData) {
        invalidatePosition(position, time, 'ambiguous bar without finer data');
        return;
      }
      closePosition(position, stopLoss as number, time);
      return;
    }

    closePosition(position, (hitStop ? stopLoss : takeProfit) as number, time);
  };

  const applySignal = (signal: Signal): void => {
    switch (signal.kind) {
      case 'open': {
        orderCounter += 1;
        pendingEntries.push({
          id: `order-${orderCounter}`,
          side: signal.side,
          orderType: signal.order.type,
          price: signal.order.price,
          riskFraction: signal.risk.fraction,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
        });
        break;
      }
      case 'close': {
        const position = positions.get(signal.positionId);
        if (position) {
          pendingExits.push({
            positionId: signal.positionId,
            portion: signal.portion ?? 1,
          });
        }
        break;
      }
      case 'moveStop': {
        positions.get(signal.positionId)?.setStopLoss(signal.price);
        break;
      }
      case 'moveTarget': {
        positions.get(signal.positionId)?.setTakeProfit(signal.price);
        break;
      }
    }
  };

  for (let s = 0; s < bars.length; s++) {
    const bar = bars[s];
    const subBars = bar.subBars.length > 0 ? bar.subBars : [bar];

    for (const sub of subBars) {
      const time = toTime(sub.date);

      for (const exit of pendingExits.splice(0)) {
        const position = positions.get(exit.positionId);
        if (!position) continue;
        const side = position.side === 'long' ? 'sell' : 'buy';
        const price = broker.alignToTick(broker.fillPrice(side, sub.open, true));
        if (exit.portion >= 1) {
          closePosition(position, price, time);
        } else {
          reducePosition(position, exit.portion, price);
        }
      }

      for (const entry of [...pendingEntries]) {
        if (fillEntry(entry, sub, time)) {
          pendingEntries.splice(pendingEntries.indexOf(entry), 1);
        }
      }

      for (const position of [...positions.values()]) {
        if (!positions.has(position.id)) continue;
        evaluateProtective(position, sub, time);
      }

      if (broker.isStopOut(equity(sub.close))) {
        for (const position of [...positions.values()]) {
          closePosition(position, sub.close, time);
        }
      }
    }

    if (s < bars.length - 1) {
      const ctx = createContext(bars, s, openPositionViews());
      const signals = validSignals(resolved.definition.onBar(ctx, resolved.params));
      for (const signal of signals) applySignal(signal);
    }

    equityCurve.push({
      time: toTime(bar.date),
      balance: broker.balance,
      equity: equity(bar.close),
    });
  }

  return { trades: closedTrades, invalidated, equityCurve, hasFinerData };
}
