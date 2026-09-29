import {
  ClosedTrade,
  EquityPoint,
  InvalidatedTrade,
  PerformanceMetrics,
} from '../../shared/types/backtest';

interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  costs: number;
  rSum: number;
  rCount: number;
}

export class MetricsCalculator {
  compute(
    trades: ClosedTrade[],
    invalidated: InvalidatedTrade[],
    equityCurve: EquityPoint[]
  ): PerformanceMetrics {
    const tradeStats = this.calculateTradeStats(trades);
    const maxDrawdown = this.calculateMaxDrawdown(equityCurve);

    return this.buildMetricsResult(tradeStats, invalidated, maxDrawdown);
  }

  private calculateTradeStats(trades: ClosedTrade[]): TradeStats {
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

    return { totalTrades: trades.length, wins, losses, breakeven, netPnl, grossProfit, grossLoss, costs, rSum, rCount };
  }

  private calculateMaxDrawdown(equityCurve: EquityPoint[]): number {
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = peak - point.equity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    return maxDrawdown;
  }

  private buildMetricsResult(
    stats: TradeStats,
    invalidated: InvalidatedTrade[],
    maxDrawdown: number
  ): PerformanceMetrics {
    const { totalTrades, wins, losses, breakeven, netPnl, grossProfit, grossLoss, costs, rSum, rCount } = stats;

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? netPnl / totalTrades : 0;

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
