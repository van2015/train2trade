import { describe, it, expect, beforeEach } from 'vitest';
import { PriceData } from '../../src/types/asset';
import { Signal, StrategyDefinition, PositionView } from '../../src/types/backtest';
import {
  clearStrategies,
  createContext,
  getStrategy,
  isValidSignal,
  registerStrategy,
  resolveStrategy,
  validSignals,
} from '../../src/backtest/Strategy';

function candles(closes: number[]): PriceData[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString().replace('.000Z', 'Z'),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

const definition: StrategyDefinition = {
  id: 'test-strategy',
  label: 'Test Strategy',
  timeframe: '1h',
  params: [
    { key: 'period', label: 'Period', default: 14, min: 1 },
    { key: 'risk', label: 'Risk', default: 0.01 },
  ],
  onBar: () => [],
};

describe('strategy registry', () => {
  beforeEach(() => {
    clearStrategies();
  });

  it('registers and resolves a strategy by id', () => {
    registerStrategy(definition);

    expect(getStrategy('test-strategy')).toBe(definition);
  });

  it('normalizes parameters against defaults and minimums', () => {
    registerStrategy(definition);

    const resolved = resolveStrategy('test-strategy', { period: 0 });

    expect(resolved.params).toEqual({ period: 1, risk: 0.01 });
  });

  it('rejects an unknown strategy id', () => {
    expect(() => resolveStrategy('missing')).toThrow();
  });
});

describe('strategy context', () => {
  it('exposes only data up to the current closed bar', () => {
    const data = candles([10, 20, 30, 40, 50]);
    const ctx = createContext(data, 2);

    expect(ctx.index).toBe(2);
    expect(ctx.series('close')).toEqual([10, 20, 30]);
    expect(ctx.candle().close).toBe(30);
  });

  it('computes indicator series causally', () => {
    const data = candles([1, 2, 3, 4, 5]);
    const ctx = createContext(data, 2);

    const [sma] = ctx.indicator('sma', { period: 2 });

    expect(sma.values).toHaveLength(3);
    expect(sma.values).toEqual([undefined, 1.5, 2.5]);
  });

  it('exposes open positions by id', () => {
    const positions: PositionView[] = [
      {
        id: 'p1',
        side: 'long',
        state: 'open',
        size: 1,
        averageEntry: 100,
        realizedPnl: 0,
      },
    ];
    const ctx = createContext(candles([1, 2, 3]), 2, positions);

    expect(ctx.positions()).toBe(positions);
    expect(ctx.positions()[0].id).toBe('p1');
  });
});

describe('signal validation', () => {
  const validOpen: Signal = {
    kind: 'open',
    side: 'long',
    order: { type: 'market' },
    risk: { fraction: 0.01 },
    stopLoss: 90,
  };

  it('accepts well-formed signals', () => {
    expect(isValidSignal(validOpen)).toBe(true);
    expect(isValidSignal({ kind: 'close', positionId: 'p1' })).toBe(true);
    expect(isValidSignal({ kind: 'moveStop', positionId: 'p1', price: 95 })).toBe(true);
    expect(isValidSignal({ kind: 'moveTarget', positionId: 'p1', price: 110 })).toBe(true);
  });

  it('rejects malformed signals', () => {
    expect(isValidSignal({ ...validOpen, risk: { fraction: 0 } })).toBe(false);
    expect(isValidSignal({ ...validOpen, side: 'sideways' as never })).toBe(false);
    expect(
      isValidSignal({ ...validOpen, order: { type: 'limit' } } as unknown as Signal)
    ).toBe(false);
    expect(isValidSignal({ kind: 'close', positionId: '' })).toBe(false);
    expect(isValidSignal({ kind: 'close', positionId: 'p1', portion: 2 })).toBe(false);
    expect(isValidSignal({ kind: 'moveStop', positionId: 'p1', price: NaN })).toBe(false);
  });

  it('filters malformed signals without mutating the input', () => {
    const input: Signal[] = [validOpen, { kind: 'close', positionId: '' }];

    const filtered = validSignals(input);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(validOpen);
    expect(input).toHaveLength(2);
  });
});
