import { describe, expect, it } from 'vitest';
import { TradingEngine } from '../../src/engine/TradingEngine';

describe('TradingEngine', () => {
  it('opens a long position with the given price and size', () => {
    const engine = new TradingEngine();

    const position = engine.open({ side: 'long', price: 100, size: 1 });

    expect(position.side).toBe('long');
    expect(position.entryPrice).toBe(100);
    expect(position.size).toBe(1);
    expect(position.state).toBe('open');
  });
});
