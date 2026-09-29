import {
  ClosedTrade,
  EquityPoint,
  InvalidatedTrade,
  PerformanceMetrics,
} from '../types/backtest';

export class MetricsCalculator {
  compute(
    trades: ClosedTrade[],
    invalidated: InvalidatedTrade[],
    equityCurve: EquityPoint[]
  ): PerformanceMetrics {
    const totalTrades = trades.length;

    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let netPnl = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let costs = 0;
    let rSum = 0;
    let rCount = 0;

    for (const trade of trades) {
      netPnl += trade.netPnl;
      costs += trade.fees;

      if (trade.netPnl > 0) {
        wins += 1;
        grossProfit += trade.netPnl;
      } else if (trade.netPnl < 0) {
        losses += 1;
        grossLoss += -trade.netPnl;
      } else {
        breakeven += 1;
      }

      if (trade.rMultiple !== undefined) {
        rSum += trade.rMultiple;
        rCount += 1;
      }
    }

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? netPnl / totalTrades : 0;

    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = peak - point.equity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    const invalidatedCount = invalidated.length;
    const allTrades = totalTrades + invalidatedCount;

    return {
      totalTrades,
      wins,
      losses,
      breakeven,
      winRate,
      netPnl,
      grossProfit,
      grossLoss,
      costs,
      profitFactor,
      expectancy,
      maxDrawdown,
      averageR: rCount > 0 ? rSum / rCount : undefined,
      invalidatedCount,
      invalidatedRatio: allTrades > 0 ? invalidatedCount / allTrades : 0,
    };
  }
}

export function computeMetrics(
  trades: ClosedTrade[],
  invalidated: InvalidatedTrade[],
  equityCurve: EquityPoint[]
): PerformanceMetrics {
  const calculator = new MetricsCalculator();
  return calculator.compute(trades, invalidated, equityCurve);
}
