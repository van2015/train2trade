import { describe, it, expect, beforeEach } from 'vitest';
import { Signal } from '../../src/types/backtest';
import {
  clearStrategies,
  createContext,
  getStrategy,
  isValidSignal,
  registerStrategy,
  resolveStrategy,
  validSignals,
} from '../../src/backtest/Strategy';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';
import { StrategyDefinitionBuilder } from '../test-helpers/strategyDefinitionBuilder';
import { PositionViewBuilder } from '../test-helpers/positionViewBuilder';
import { SignalBuilder } from '../test-helpers/signalBuilder';

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
    const positions = [new PositionViewBuilder().id('p1').open().size(1).build()];
    const ctx = createContext(candles([1, 2, 3]), 2, positions);

    expect(ctx.positions()).toBe(positions);
    expect(ctx.positions()[0].id).toBe('p1');
  });
});

describe('signal validation', () => {
  const validOpen: Signal = SignalBuilder.long().market().risk(0.01).stopLoss(90).build();

  it('accepts well-formed signals', () => {
    expect(isValidSignal(validOpen)).toBe(true);
    expect(isValidSignal(SignalBuilder.close('p1').build())).toBe(true);
    expect(isValidSignal(SignalBuilder.moveStop('p1', 95).build())).toBe(true);
    expect(isValidSignal(SignalBuilder.moveTarget('p1', 110).build())).toBe(true);
  });

  it('rejects malformed signals', () => {
    expect(
      isValidSignal(SignalBuilder.long().market().risk(0).stopLoss(90).build())
    ).toBe(false);
    expect(isValidSignal(SignalBuilder.long().limit(NaN).build())).toBe(false);
    expect(isValidSignal(SignalBuilder.close('').build())).toBe(false);
    expect(isValidSignal(SignalBuilder.close('p1').portion(2).build())).toBe(false);
    expect(isValidSignal(SignalBuilder.moveStop('p1', NaN).build())).toBe(false);
  });

  it('filters malformed signals without mutating the input', () => {
    const input: Signal[] = [validOpen, SignalBuilder.close('').build()];

    const filtered = validSignals(input);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(validOpen);
    expect(input).toHaveLength(2);
  });
});

describe('SignalBuilder', () => {
  it('requires an explicit order type', () => {
    expect(() => SignalBuilder.long().stopLoss(50).build()).toThrow();
    expect(() => SignalBuilder.short().stopLoss(50).build()).toThrow();
  });
});
