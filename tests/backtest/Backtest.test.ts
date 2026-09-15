import { describe, it, expect, beforeEach } from 'vitest';
import { PriceData } from '../../src/types/asset';
import { BacktestInput, StrategyDefinition } from '../../src/types/backtest';
import { clearStrategies, registerStrategy } from '../../src/backtest/Strategy';
import { runBacktest } from '../../src/backtest/Backtest';
import { PlatformConfigBuilder } from '../test-helpers/platformConfigBuilder';
import { SignalBuilder } from '../test-helpers/signalBuilder';
import { BacktestInputBuilder } from '../test-helpers/backtestInputBuilder';
import { StrategyDefinitionBuilder } from '../test-helpers/strategyDefinitionBuilder';
import { PriceSeriesBuilder } from '../test-helpers/priceSeriesBuilder';

function platformConfig(): PlatformConfigBuilder {
  return new PlatformConfigBuilder()
    .withContractSize(1)
    .withMinLot(0.01)
    .withLotStep(0.01)
    .withTickSize(0.01)
    .withLeverage(1000)
    .withCommissionPerLot(0)
    .withSpread(0)
    .withSlippage(0)
    .withStopOutLevel(0);
}

function register(
  id: string,
  timeframe: StrategyDefinition['timeframe'],
  onBar: StrategyDefinition['onBar']
): void {
  registerStrategy(
    new StrategyDefinitionBuilder().id(id).label(id).timeframe(timeframe).onBar(onBar).build()
  );
}

function baseInput(dataset: PriceData[], strategyId: string): BacktestInput {
  return new BacktestInputBuilder()
    .data(dataset)
    .strategy(strategyId)
    .platform(platformConfig().build())
    .initialBalance(10000)
    .build();
}

describe('runBacktest', () => {
  beforeEach(() => {
    clearStrategies();
  });

  it('fills a market order at the next sub-bar open', () => {
    register('market-once', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(50).takeProfit(108).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T00:01:00Z').open(105).high(106).low(104)
      .at('2024-01-01T00:02:00Z').open(105).high(110).low(104)
      .build();

    const result = runBacktest(baseInput(dataset, 'market-once'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].averageEntry).toBeCloseTo(105);
    expect(result.trades[0].openedAt).toBe(new Date('2024-01-01T00:01:00Z').getTime());
    expect(result.trades[0].netPnl).toBeGreaterThan(0);
  });

  it('fills a limit order intrabar at the limit price or better', () => {
    register('limit-once', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().limit(100).stopLoss(50).takeProfit(105).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T00:01:00Z').open(101).high(102).low(99)
      .at('2024-01-01T00:02:00Z').open(101).high(106)
      .build();

    const result = runBacktest(baseInput(dataset, 'limit-once'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].averageEntry).toBeCloseTo(100);
  });

  it('does not open a position when the limit is never reached', () => {
    register('limit-never', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().limit(90).stopLoss(50).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T00:01:00Z').open(101).high(102).low(100)
      .build();

    const result = runBacktest(baseInput(dataset, 'limit-never'));

    expect(result.trades).toHaveLength(0);
    expect(result.invalidated).toHaveLength(0);
  });

  it('closes at take profit and cancels the paired stop (OCO)', () => {
    register('oco', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(95).takeProfit(105).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T00:01:00Z').open(100).high(106).low(99)
      .build();

    const result = runBacktest(baseInput(dataset, 'oco'));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].netPnl).toBeCloseTo((105 - 100) * result.trades[0].size);
  });

  it('invalidates a trade on an ambiguous bar when no finer data exists', () => {
    register('ambiguous', '1h', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(95).takeProfit(105).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T01:00:00Z').open(100).high(110).low(90)
      .build();

    const result = runBacktest(baseInput(dataset, 'ambiguous'));

    expect(result.hasFinerData).toBe(false);
    expect(result.trades).toHaveLength(0);
    expect(result.invalidated).toHaveLength(1);
    expect(result.equityCurve[result.equityCurve.length - 1].equity).toBeCloseTo(10000);
  });

  it('resolves an ambiguous strategy bar using finer sub-bars', () => {
    register('finer', '5m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(95).takeProfit(105).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .inert('2024-01-01T00:01:00Z')
      .inert('2024-01-01T00:02:00Z')
      .inert('2024-01-01T00:03:00Z')
      .inert('2024-01-01T00:04:00Z')
      .at('2024-01-01T00:05:00Z').open(100).high(101).low(90)
      .build();

    const result = runBacktest(baseInput(dataset, 'finer'));

    expect(result.hasFinerData).toBe(true);
    expect(result.trades).toHaveLength(1);
    expect(result.invalidated).toHaveLength(0);
    expect(result.trades[0].averageEntry).toBeCloseTo(100);
    expect(result.trades[0].netPnl).toBeLessThan(0);
  });

  it('rejects an open whose risk-based size is below the minimum lot', () => {
    register('too-small', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(50).risk(0.000001).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .inert('2024-01-01T00:01:00Z')
      .build();

    const input = new BacktestInputBuilder()
      .data(dataset)
      .strategy('too-small')
      .platform(platformConfig().withMinLot(1).withLotStep(1).build())
      .initialBalance(10000)
      .build();

    const result = runBacktest(input);

    expect(result.trades).toHaveLength(0);
  });

  it('produces deterministic results across repeated runs', () => {
    register('deterministic', '1m', ctx =>
      ctx.index === 0
        ? [new SignalBuilder().long().market().stopLoss(50).takeProfit(108).build()]
        : []
    );

    const dataset = new PriceSeriesBuilder()
      .inert('2024-01-01T00:00:00Z')
      .at('2024-01-01T00:01:00Z').open(100).high(110).low(99)
      .build();

    const first = runBacktest(baseInput(dataset, 'deterministic'));
    const second = runBacktest(baseInput(dataset, 'deterministic'));

    expect(second).toEqual(first);
  });
});
