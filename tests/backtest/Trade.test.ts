import { describe, it, expect } from 'vitest';
import { Trade } from '../../src/backtest/Trade';

describe('Trade', () => {
  it('starts pending and opens on its first fill', () => {
    const trade = new Trade('p1', 'long');

    expect(trade.state).toBe('pending');

    trade.addFill(1, 100);

    expect(trade.state).toBe('open');
    expect(trade.size).toBe(1);
    expect(trade.averageEntry).toBe(100);
  });

  it('keeps a fill ledger and derives the average entry', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.addFill(1, 120);

    expect(trade.fills).toHaveLength(2);
    expect(trade.size).toBe(2);
    expect(trade.averageEntry).toBeCloseTo(110);
  });

  it('increases an open trade with pyramiding', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(2, 100);
    trade.addFill(2, 140);

    expect(trade.size).toBe(4);
    expect(trade.averageEntry).toBeCloseTo(120);
    expect(trade.state).toBe('open');
  });

  it('realizes PnL on a partial reduce and keeps the trade open', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);

    const applied = trade.reduce(0.5, 110);

    expect(applied).toBe(true);
    expect(trade.realizedPnl).toBeCloseTo(5);
    expect(trade.size).toBe(0.5);
    expect(trade.state).toBe('open');
  });

  it('rejects a reduce larger than the remaining size without changing the trade', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.reduce(0.5, 110);

    const applied = trade.reduce(1, 120);

    expect(applied).toBe(false);
    expect(trade.size).toBe(0.5);
    expect(trade.realizedPnl).toBeCloseTo(5);
  });

  it('moves the stop loss while preserving the initial stop', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.setStopLoss(90);
    trade.setStopLoss(105);

    expect(trade.stopLoss).toBe(105);
    expect(trade.initialStopLoss).toBe(90);
  });

  it('moves the take profit', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.setTakeProfit(120);
    trade.setTakeProfit(130);

    expect(trade.takeProfit).toBe(130);
  });

  it('closes with a final realized PnL and becomes immutable', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.close(130);

    expect(trade.state).toBe('closed');
    expect(trade.size).toBe(0);
    expect(trade.realizedPnl).toBeCloseTo(30);

    expect(() => trade.addFill(1, 100)).toThrow();
    expect(() => trade.setStopLoss(90)).toThrow();
    expect(() => trade.reduce(1, 100)).toThrow();
  });

  it('computes direction-aware PnL for long trades', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.close(130);

    expect(trade.realizedPnl).toBeCloseTo(30);
  });

  it('computes direction-aware PnL for short trades', () => {
    const profitable = new Trade('p1', 'short');
    profitable.addFill(1, 100);
    profitable.close(90);

    expect(profitable.realizedPnl).toBeCloseTo(10);

    const losing = new Trade('p2', 'short');
    losing.addFill(1, 100);
    losing.close(110);

    expect(losing.realizedPnl).toBeCloseTo(-10);
  });

  it('computes R against the preserved initial stop after it was moved', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.setStopLoss(90);
    trade.setStopLoss(110);
    trade.close(130);

    expect(trade.rMultiple).toBeCloseTo(3);
  });

  it('exposes the initial risk amount', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(2, 100);
    trade.setStopLoss(90);

    expect(trade.riskAmount).toBeCloseTo(20);
  });

  it('does not produce an R multiple without an initial stop', () => {
    const trade = new Trade('p1', 'long');
    trade.addFill(1, 100);
    trade.close(110);

    expect(trade.rMultiple).toBeUndefined();
    expect(trade.riskAmount).toBeUndefined();
  });

  it('closes a pending trade without realized PnL', () => {
    const trade = new Trade('p1', 'long');
    trade.close(100);

    expect(trade.state).toBe('closed');
    expect(trade.realizedPnl).toBe(0);
  });
});
