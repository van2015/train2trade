import { describe, it, expect } from 'vitest';
import { Position } from '../../src/backtest/Position';

describe('Position', () => {
  it('starts pending and opens on its first fill', () => {
    const position = new Position('p1', 'long');

    expect(position.state).toBe('pending');

    position.addFill(1, 100);

    expect(position.state).toBe('open');
    expect(position.size).toBe(1);
    expect(position.averageEntry).toBe(100);
  });

  it('keeps a fill ledger and derives the average entry', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.addFill(1, 120);

    expect(position.fills).toHaveLength(2);
    expect(position.size).toBe(2);
    expect(position.averageEntry).toBeCloseTo(110);
  });

  it('increases an open position with pyramiding', () => {
    const position = new Position('p1', 'long');
    position.addFill(2, 100);
    position.addFill(2, 140);

    expect(position.size).toBe(4);
    expect(position.averageEntry).toBeCloseTo(120);
    expect(position.state).toBe('open');
  });

  it('realizes PnL on a partial reduce and keeps the position open', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);

    const applied = position.reduce(0.5, 110);

    expect(applied).toBe(true);
    expect(position.realizedPnl).toBeCloseTo(5);
    expect(position.size).toBe(0.5);
    expect(position.state).toBe('open');
  });

  it('rejects a reduce larger than the remaining size without changing the position', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.reduce(0.5, 110);

    const applied = position.reduce(1, 120);

    expect(applied).toBe(false);
    expect(position.size).toBe(0.5);
    expect(position.realizedPnl).toBeCloseTo(5);
  });

  it('moves the stop loss while preserving the initial stop', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.setStopLoss(90);
    position.setStopLoss(105);

    expect(position.stopLoss).toBe(105);
    expect(position.initialStopLoss).toBe(90);
  });

  it('moves the take profit', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.setTakeProfit(120);
    position.setTakeProfit(130);

    expect(position.takeProfit).toBe(130);
  });

  it('closes with a final realized PnL and becomes immutable', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.close(130);

    expect(position.state).toBe('closed');
    expect(position.size).toBe(0);
    expect(position.realizedPnl).toBeCloseTo(30);

    expect(() => position.addFill(1, 100)).toThrow();
    expect(() => position.setStopLoss(90)).toThrow();
    expect(() => position.reduce(1, 100)).toThrow();
  });

  it('computes direction-aware PnL for long positions', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.close(130);

    expect(position.realizedPnl).toBeCloseTo(30);
  });

  it('computes direction-aware PnL for short positions', () => {
    const profitable = new Position('p1', 'short');
    profitable.addFill(1, 100);
    profitable.close(90);

    expect(profitable.realizedPnl).toBeCloseTo(10);

    const losing = new Position('p2', 'short');
    losing.addFill(1, 100);
    losing.close(110);

    expect(losing.realizedPnl).toBeCloseTo(-10);
  });

  it('computes R against the preserved initial stop after it was moved', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.setStopLoss(90);
    position.setStopLoss(110);
    position.close(130);

    expect(position.rMultiple).toBeCloseTo(3);
  });

  it('does not produce an R multiple without an initial stop', () => {
    const position = new Position('p1', 'long');
    position.addFill(1, 100);
    position.close(110);

    expect(position.rMultiple).toBeUndefined();
  });

  it('closes a pending position without realized PnL', () => {
    const position = new Position('p1', 'long');
    position.close(100);

    expect(position.state).toBe('closed');
    expect(position.realizedPnl).toBe(0);
  });
});
