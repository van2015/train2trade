import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../../src/backtest/Metrics';
import { ClosedTradeBuilder } from '../test-helpers/closedTradeBuilder';
import { InvalidatedTradeBuilder } from '../test-helpers/invalidatedTradeBuilder';
import { EquityPointBuilder } from '../test-helpers/equityPointBuilder';

function trade(netPnl: number, fees = 0, rMultiple?: number) {
  const builder = new ClosedTradeBuilder().netPnl(netPnl).fees(fees);
  if (rMultiple !== undefined) builder.rMultiple(rMultiple);
  return builder.build();
}

function invalidated(id: string) {
  return new InvalidatedTradeBuilder().id(id).build();
}

function curve(values: number[]) {
  return EquityPointBuilder.series(values);
}

describe('computeMetrics', () => {
  it('returns zeroed metrics when there are no trades', () => {
    const metrics = computeMetrics([], [], []);

    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.netPnl).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.expectancy).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.averageR).toBeUndefined();
    expect(metrics.invalidatedRatio).toBe(0);
  });

  it('counts wins, losses and breakeven trades', () => {
    const metrics = computeMetrics([trade(10), trade(-5), trade(0)], [], []);

    expect(metrics.totalTrades).toBe(3);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(1);
    expect(metrics.breakeven).toBe(1);
    expect(metrics.winRate).toBeCloseTo(1 / 3);
  });

  it('computes PnL statistics', () => {
    const metrics = computeMetrics([trade(10, 1), trade(-4, 1)], [], []);

    expect(metrics.netPnl).toBeCloseTo(6);
    expect(metrics.grossProfit).toBeCloseTo(10);
    expect(metrics.grossLoss).toBeCloseTo(4);
    expect(metrics.costs).toBeCloseTo(2);
    expect(metrics.profitFactor).toBeCloseTo(2.5);
    expect(metrics.expectancy).toBeCloseTo(3);
  });

  it('reports an unbounded profit factor when there are no losses', () => {
    const metrics = computeMetrics([trade(10), trade(5)], [], []);

    expect(metrics.profitFactor).toBe(Infinity);
  });

  it('computes maximum drawdown from the equity curve', () => {
    const metrics = computeMetrics([], [], curve([10000, 12000, 9000, 11000]));

    expect(metrics.maxDrawdown).toBeCloseTo(3000);
  });

  it('averages R only over trades with a defined R', () => {
    const metrics = computeMetrics([trade(10, 0, 2), trade(5, 0, 4), trade(1)], [], []);

    expect(metrics.averageR).toBeCloseTo(3);
  });

  it('reports invalidated trades separately and excludes them from PnL and win rate', () => {
    const metrics = computeMetrics([trade(10), trade(-5)], [invalidated('i1')], []);

    expect(metrics.invalidatedCount).toBe(1);
    expect(metrics.invalidatedRatio).toBeCloseTo(1 / 3);
    expect(metrics.netPnl).toBeCloseTo(5);
    expect(metrics.winRate).toBeCloseTo(0.5);
  });
});
