import { describe, it, expect, beforeEach } from 'vitest';
import { PriceData } from '../../src/types/asset';
import { BacktestInput, PlatformConfig, Signal } from '../../src/types/backtest';
import { clearStrategies, registerStrategy } from '../../src/backtest/Strategy';
import { runBacktest } from '../../src/backtest/Backtest';

function candle(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1
): PriceData {
  return { date, open, high, low, close, volume };
}

const basePlatform: PlatformConfig = {
  contractSize: 1,
  minLot: 0.01,
  lotStep: 0.01,
  tickSize: 0.01,
  leverage: 1000,
  commissionPerLot: 0,
  spread: 0,
  slippage: 0,
  stopOutLevel: 0,
};

function openSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    kind: 'open',
    side: 'long',
    order: { type: 'market' },
    risk: { fraction: 0.01 },
    stopLoss: 50,
    takeProfit: 108,
    ...overrides,
  } as Signal;
}

function baseInput(dataset: PriceData[], strategyId: string): BacktestInput {
  return {
    dataset,
    strategyId,
    platform: basePlatform,
    initialBalance: 10000,
  };
}

describe('runBacktest', () => {
  beforeEach(() => {
    clearStrategies();
  });

  it('fills a market order at the next sub-bar open', () => {
    registerStrategy({
      id: 'market-once',
      label: 'Market once',
      timeframe: '1m',
      params: [],
      onBar: ctx => (ctx.index === 0 ? [openSignal()] : []),
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 105, 106, 104, 105),
      candle('2024-01-01T00:02:00Z', 105, 111, 104, 110),
    ];

    const result = runBacktest(baseInput(dataset, 'market-once'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].averageEntry).toBeCloseTo(105);
    expect(result.trades[0].openedAt).toBe(new Date('2024-01-01T00:01:00Z').getTime());
    expect(result.trades[0].netPnl).toBeGreaterThan(0);
  });

  it('fills a limit order intrabar at the limit price or better', () => {
    registerStrategy({
      id: 'limit-once',
      label: 'Limit once',
      timeframe: '1m',
      params: [],
      onBar: ctx =>
        ctx.index === 0
          ? [openSignal({ order: { type: 'limit', price: 100 }, takeProfit: 105 })]
          : [],
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 101, 102, 99, 101),
      candle('2024-01-01T00:02:00Z', 101, 106, 100, 105),
    ];

    const result = runBacktest(baseInput(dataset, 'limit-once'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].averageEntry).toBeCloseTo(100);
  });

  it('does not open a position when the limit is never reached', () => {
    registerStrategy({
      id: 'limit-never',
      label: 'Limit never',
      timeframe: '1m',
      params: [],
      onBar: ctx =>
        ctx.index === 0 ? [openSignal({ order: { type: 'limit', price: 90 } })] : [],
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 101, 102, 100, 101),
      candle('2024-01-01T00:02:00Z', 101, 106, 100, 105),
    ];

    const result = runBacktest(baseInput(dataset, 'limit-never'));

    expect(result.trades).toHaveLength(0);
    expect(result.invalidated).toHaveLength(0);
  });

  it('closes at take profit and cancels the paired stop (OCO)', () => {
    registerStrategy({
      id: 'oco',
      label: 'OCO',
      timeframe: '1m',
      params: [],
      onBar: ctx =>
        ctx.index === 0 ? [openSignal({ stopLoss: 95, takeProfit: 105 })] : [],
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 100, 106, 99, 105),
      candle('2024-01-01T00:02:00Z', 105, 110, 100, 108),
    ];

    const result = runBacktest(baseInput(dataset, 'oco'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].netPnl).toBeCloseTo((105 - 100) * result.trades[0].size);
  });

  it('invalidates a trade on an ambiguous bar when no finer data exists', () => {
    registerStrategy({
      id: 'ambiguous',
      label: 'Ambiguous',
      timeframe: '1h',
      params: [],
      onBar: ctx =>
        ctx.index === 0 ? [openSignal({ stopLoss: 95, takeProfit: 105 })] : [],
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T01:00:00Z', 100, 110, 90, 100),
      candle('2024-01-01T02:00:00Z', 100, 101, 99, 100),
    ];

    const result = runBacktest(baseInput(dataset, 'ambiguous'));

    expect(result.hasFinerData).toBe(false);
    expect(result.trades).toHaveLength(0);
    expect(result.invalidated).toHaveLength(1);
    expect(result.equityCurve[result.equityCurve.length - 1].equity).toBeCloseTo(10000);
  });

  it('resolves an ambiguous strategy bar using finer sub-bars', () => {
    registerStrategy({
      id: 'finer',
      label: 'Finer',
      timeframe: '5m',
      params: [],
      onBar: ctx =>
        ctx.index === 0 ? [openSignal({ stopLoss: 95, takeProfit: 105 })] : [],
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:02:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:03:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:04:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:05:00Z', 100, 101, 90, 91),
      candle('2024-01-01T00:06:00Z', 91, 106, 90, 105),
      candle('2024-01-01T00:07:00Z', 105, 106, 104, 105),
      candle('2024-01-01T00:08:00Z', 105, 106, 104, 105),
      candle('2024-01-01T00:09:00Z', 105, 106, 104, 105),
    ];

    const result = runBacktest(baseInput(dataset, 'finer'));

    expect(result.hasFinerData).toBe(true);
    expect(result.trades).toHaveLength(1);
    expect(result.invalidated).toHaveLength(0);
    expect(result.trades[0].averageEntry).toBeCloseTo(100);
    expect(result.trades[0].netPnl).toBeLessThan(0);
  });

  it('rejects an open whose risk-based size is below the minimum lot', () => {
    registerStrategy({
      id: 'too-small',
      label: 'Too small',
      timeframe: '1m',
      params: [],
      onBar: ctx => (ctx.index === 0 ? [openSignal({ risk: { fraction: 0.000001 } })] : []),
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:02:00Z', 100, 101, 99, 100),
    ];

    const input = baseInput(dataset, 'too-small');
    input.platform = { ...basePlatform, minLot: 1, lotStep: 1 };

    const result = runBacktest(input);

    expect(result.trades).toHaveLength(0);
  });

  it('produces deterministic results across repeated runs', () => {
    registerStrategy({
      id: 'deterministic',
      label: 'Deterministic',
      timeframe: '1m',
      params: [],
      onBar: ctx => (ctx.index === 0 ? [openSignal()] : []),
    });

    const dataset = [
      candle('2024-01-01T00:00:00Z', 100, 101, 99, 100),
      candle('2024-01-01T00:01:00Z', 105, 106, 104, 105),
      candle('2024-01-01T00:02:00Z', 105, 111, 104, 110),
    ];

    const first = runBacktest(baseInput(dataset, 'deterministic'));
    const second = runBacktest(baseInput(dataset, 'deterministic'));

    expect(second).toEqual(first);
  });
});
