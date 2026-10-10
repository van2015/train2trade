import { describe, expect, it } from 'vitest';
import { TradingEngine } from '../../src/engine/TradingEngine';
import { PositionBuilder } from '../test-helpers/positionBuilder';

describe('TradingEngine', () => {
  it('opens a long position with the given price and size', () => {
    const engine = new TradingEngine();

    const position = engine.open({ side: 'long', price: 100, size: 1 });

    expect(position.side).toBe('long');
    expect(position.entryPrice).toBe(100);
    expect(position.size).toBe(1);
    expect(position.state).toBe('open');
  });

  it('closes an open position with the exit price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().long().build();

    const closed = engine.close(position, 110);

    expect(closed.state).toBe('closed');
    expect(closed.exitPrice).toBe(110);
    expect(position.state).toBe('open');
    expect(position.exitPrice).toBeUndefined();
  });

  it('calculates PnL when closing a long position', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(100)
      .size(2)
      .build();

    const closed = engine.close(position, 110);

    expect(closed.pnl).toBe(10);
  });

  it('expresses PnL as a percentage of the entry price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(250)
      .size(3)
      .build();

    const closed = engine.close(position, 275);

    expect(closed.pnl).toBe(10);
  });

  it('calculates PnL for a short position (closing below entry gains)', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().short().entryPrice(100).build();

    const closed = engine.close(position, 90);

    expect(closed.pnl).toBe(10);
  });
});
