import { describe, it, expect } from 'vitest';
import { PriceData, IndicatorId } from '../../src/shared/types/asset';
import { compute, computeSeries } from '../../src/backtest/indicators/IndicatorService';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';
import { IndicatorInstanceBuilder } from '../test-helpers/indicatorInstanceBuilder';

function instance(indicatorId: IndicatorId, params: Record<string, number>) {
  return new IndicatorInstanceBuilder().id(indicatorId).params(params).build();
}

const cases: { id: IndicatorId; params: Record<string, number>; candles: PriceData[] }[] = [
  { id: 'sma', params: { period: 3 }, candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5]) },
  { id: 'ema', params: { period: 3 }, candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 10]) },
  {
    id: 'bb',
    params: { period: 3, stdDev: 2 },
    candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5]),
  },
  { id: 'rsi', params: { period: 2 }, candles: SamplePriceBuilder.fromCloses([1, 2, 1, 2, 3]) },
  {
    id: 'macd',
    params: { fast: 2, slow: 3, signal: 2 },
    candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  },
  {
    id: 'volume',
    params: {},
    candles: SamplePriceBuilder.fromCloses([10, 10], { volumes: [100, 200], opens: [10, 11] }),
  },
];

describe('IndicatorService.computeSeries', () => {
  it('returns index-aligned numeric values matching the chart plots', () => {
    for (const testCase of cases) {
      const series = computeSeries(instance(testCase.id, testCase.params), testCase.candles);
      const plots = compute(instance(testCase.id, testCase.params), testCase.candles);

      expect(series.map(entry => entry.key)).toEqual(plots.map(plot => plot.key));

      for (let i = 0; i < series.length; i++) {
        const values = series[i].values;
        const points = plots[i].data;
        expect(values).toHaveLength(testCase.candles.length);
        expect(values).toEqual(points.map(point => point.value));
      }
    }
  });

  it('produces numeric values only, without rendering fields', () => {
    const series = computeSeries(instance('sma', { period: 3 }), cases[0].candles);

    expect(series).toHaveLength(1);
    expect(Object.keys(series[0]).sort()).toEqual(['key', 'values']);
  });

  it('omits warm-up values instead of zero-filling', () => {
    const series = computeSeries(
      instance('sma', { period: 3 }),
      SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5])
    );

    expect(series[0].values).toEqual([undefined, undefined, 2, 3, 4]);
  });

  it('preserves per-indicator expected values', () => {
    const smaSeries = computeSeries(
      instance('sma', { period: 3 }),
      SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5])
    );
    expect(smaSeries[0].values[2]).toBeCloseTo(2);

    const rsiSeries = computeSeries(
      instance('rsi', { period: 2 }),
      SamplePriceBuilder.fromCloses([1, 2, 1, 2, 3])
    );
    expect(rsiSeries[0].values[2]).toBeCloseTo(50);

    const macdSeries = computeSeries(
      instance('macd', { fast: 2, slow: 3, signal: 2 }),
      SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    );
    const histogram = macdSeries.find(entry => entry.key === 'histogram')!;
    expect(histogram.values[3]).toBeCloseTo(0);
  });
});
