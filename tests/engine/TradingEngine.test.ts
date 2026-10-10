import { describe, expect, it } from 'vitest';
import { TradingEngine } from '../../src/engine/TradingEngine';
import { PositionBuilder } from '../test-helpers/positionBuilder';
import { expectError, unwrap } from '../test-helpers/unwrap';

describe('TradingEngine', () => {
  it('opens a long position with the given price and size', () => {
    const engine = new TradingEngine();

    const position = unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    expect(position.side).toBe('long');
    expect(position.entryPrice).toBe(100);
    expect(position.size).toBe(1);
    expect(position.state).toBe('open');
  });

  it('rejects opening a position with a non-positive price', () => {
    const engine = new TradingEngine();

    const result = engine.open({ side: 'long', price: 0, size: 1 });

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_PRICE');
  });

  it('rejects opening a position with a non-positive size', () => {
    const engine = new TradingEngine();

    const result = engine.open({ side: 'long', price: 100, size: 0 });

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_SIZE');
  });

  it('tracks open positions after opening them', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    unwrap(engine.open({ side: 'short', price: 50, size: 1 }));

    expect(engine.openPositions).toHaveLength(2);
    expect(engine.openPositions.map((p) => p.entryPrice)).toEqual([100, 50]);

    const [first] = engine.openPositions;
    unwrap(engine.close(first, 110));

    expect(engine.openPositions).toHaveLength(1);
  });

  it('closes an open position with the exit price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().long().build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.state).toBe('closed');
    expect(closed.exitPrice).toBe(110);
    expect(position.state).toBe('open');
    expect(position.exitPrice).toBeUndefined();
  });

  it('rejects closing a position that is already closed', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().long().state('closed').build();

    const result = engine.close(position, 110);

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('POSITION_NOT_OPEN');
  });

  it('calculates PnL when closing a long position', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(100)
      .size(2)
      .build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.pnl).toBe(10);
  });

  it('expresses PnL as a percentage of the entry price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(100)
      .size(3)
      .build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.pnl).toBe(10);
  });

  it('calculates PnL for a short position (closing below entry gains)', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().short().entryPrice(100).build();

    const closed = unwrap(engine.close(position, 90));

    expect(closed.pnl).toBe(10);
  });
});
