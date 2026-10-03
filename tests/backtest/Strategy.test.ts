import { describe, it, expect, beforeEach } from 'vitest';
import { TradeSpec } from '../../src/backtest/types/backtest';
import {
  clearStrategies,
  createContext,
  getStrategy,
  isValidTradeSpec,
  registerStrategy,
  resolveStrategy,
  validTradeSpecs,
} from '../../src/backtest/services/StrategyManager';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';
import { StrategyDefinitionBuilder } from '../test-helpers/strategyDefinitionBuilder';
import { TradeViewBuilder } from '../test-helpers/tradeViewBuilder';
import { TradeBuilder } from '../test-helpers/tradeBuilder';

function candles(closes: number[]) {
  return SamplePriceBuilder.fromCloses(closes);
}

const definition = new StrategyDefinitionBuilder()
  .id('test-strategy')
  .label('Test Strategy')
  .timeframe('1h')
  .param({ key: 'period', label: 'Period', default: 14, min: 1 })
  .param({ key: 'risk', label: 'Risk', default: 0.01 })
  .build();

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

    const result = resolveStrategy('test-strategy', { period: 0 });

    expect(result.success).toBe(true);
    expect(result.success && result.value.params).toEqual({ period: 1, risk: 0.01 });
  });

  it('rejects an unknown strategy id', () => {
    const result = resolveStrategy('missing');

    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('STRATEGY_NOT_FOUND');
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

  it('exposes open trades by id', () => {
    const trades = [new TradeViewBuilder().id('p1').open().size(1).build()];
    const ctx = createContext(candles([1, 2, 3]), 2, trades);

    expect(ctx.trades()).toBe(trades);
    expect(ctx.trades()[0].id).toBe('p1');
  });
});

describe('trade spec validation', () => {
  const validLong: TradeSpec = new TradeBuilder().long().market().risk(0.01).stopLoss(90).build();

  it('accepts well-formed trade specs', () => {
    expect(isValidTradeSpec(validLong)).toBe(true);
    expect(isValidTradeSpec(new TradeBuilder().short().limit(100).risk(0.02).build())).toBe(true);
    expect(
      isValidTradeSpec(
        new TradeBuilder()
          .long()
          .market()
          .stopLoss(90)
          .trailingStop(20)
          .breakEvenAtR(1)
          .partialTakeProfit(0.5, 1.5)
          .closeWhen(() => true)
          .build()
      )
    ).toBe(true);
  });

  it('rejects a trade spec with a non-positive risk', () => {
    expect(
      isValidTradeSpec(new TradeBuilder().long().market().risk(0).stopLoss(90).build())
    ).toBe(false);
  });

  it('rejects a limit order without a price', () => {
    expect(isValidTradeSpec(new TradeBuilder().short().limit(NaN).build())).toBe(false);
  });

  it('rejects a trailing stop with a non-positive distance', () => {
    expect(
      isValidTradeSpec(new TradeBuilder().long().market().trailingStop(0).build())
    ).toBe(false);
  });

  it('rejects a partial take profit with an out-of-range portion', () => {
    expect(
      isValidTradeSpec(new TradeBuilder().long().market().partialTakeProfit(2, 1).build())
    ).toBe(false);
  });

  it('rejects a close rule without a predicate', () => {
    const spec = new TradeBuilder().long().market().build();
    const malformed = { ...spec, rules: [{ kind: 'closeWhen' }] } as unknown as TradeSpec;

    expect(isValidTradeSpec(malformed)).toBe(false);
  });

  it('filters malformed trade specs without mutating the input', () => {
    const input: TradeSpec[] = [validLong, new TradeBuilder().long().market().risk(0).build()];

    const filtered = validTradeSpecs(input);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(validLong);
    expect(input).toHaveLength(2);
  });
});

describe('TradeBuilder', () => {
  it('requires a side', () => {
    expect(() => new TradeBuilder().market().build()).toThrow();
  });

  it('requires an order type', () => {
    expect(() => new TradeBuilder().long().build()).toThrow();
  });
});
