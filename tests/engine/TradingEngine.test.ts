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
    const position = new PositionBuilder().build();

    const closed = engine.close(position, 110);

    expect(closed.state).toBe('closed');
    expect(closed.exitPrice).toBe(110);
    expect(position.state).toBe('open');
    expect(position.exitPrice).toBeUndefined();
  });

  it('calcula el PnL al cerrar una posición larga', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().entryPrice(100).size(2).build();

    const closed = engine.close(position, 110);

    expect(closed.pnl).toBe(20);
  });
});
