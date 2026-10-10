import { describe, expect, it } from 'vitest';
import {
  compute,
  computeSeries,
  createIndicatorInstance,
  getDefinition,
  getIndicatorGroups,
  maxLookback,
  normalizeParams,
} from '../../src/backtest/indicators/IndicatorService';
import type {
  IndicatorId,
  IndicatorInstance,
  PriceData,
} from '../../src/shared/types/asset';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value to be defined');
  return value;
}

function candles(
  closes: number[],
  volumes?: number[],
  opens?: number[]
): PriceData[] {
  return closes.map((close, i) => {
    const open = opens?.[i] ?? close;
    return {
      date: new Date(Date.UTC(2024, 0, 1, 0, i))
        .toISOString()
        .replace('.000Z', 'Z'),
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: volumes?.[i] ?? 1,
    };
  });
}

function instance(
  indicatorId: IndicatorId,
  params: Record<string, number> = {}
): IndicatorInstance {
  return { key: `${indicatorId}-1`, indicatorId, params };
}

function plotsOf(
  indicatorId: IndicatorInstance['indicatorId'],
  params: Record<string, number>,
  data: PriceData[]
) {
  const result = compute(instance(indicatorId, params), data);
  expect(result.success).toBe(true);
  return result.success ? result.value : [];
}

function seriesOf(
  indicatorId: IndicatorInstance['indicatorId'],
  params: Record<string, number>,
  data: PriceData[]
) {
  const result = computeSeries(instance(indicatorId, params), data);
  expect(result.success).toBe(true);
  return result.success ? result.value : [];
}

describe('IndicatorService', () => {
  describe('compute', () => {
    it('computes SMA and omits leading values without enough data', () => {
      const plots = plotsOf('sma', { period: 3 }, candles([1, 2, 3, 4, 5]));

      expect(plots).toHaveLength(1);
      expect(plots[0].data.map((point) => point.value)).toEqual([
        undefined,
        undefined,
        2,
        3,
        4,
      ]);
    });

    it('omits values as whitespace rather than zero-filling', () => {
      const plots = plotsOf('sma', { period: 3 }, candles([1, 2, 3, 4, 5]));

      expect('value' in plots[0].data[0]).toBe(false);
      expect('value' in plots[0].data[1]).toBe(false);
      expect('value' in plots[0].data[2]).toBe(true);
    });

    it('computes EMA with an SMA seed', () => {
      const plots = plotsOf('ema', { period: 3 }, candles([1, 2, 3, 4, 10]));

      const values = plots[0].data.map((point) => point.value);
      expect(values[0]).toBeUndefined();
      expect(values[1]).toBeUndefined();
      expect(values[2]).toBeCloseTo(2);
      expect(values[3]).toBeCloseTo(3);
      expect(values[4]).toBeCloseTo(6.5);
    });

    it('computes Bollinger Bands as three plots', () => {
      const plots = plotsOf(
        'bb',
        { period: 3, stdDev: 2 },
        candles([1, 2, 3, 4, 5])
      );

      expect(plots.map((plot) => plot.key)).toEqual([
        'upper',
        'middle',
        'lower',
      ]);
      const middle = must(plots.find((plot) => plot.key === 'middle'));
      const upper = must(plots.find((plot) => plot.key === 'upper'));
      const lower = must(plots.find((plot) => plot.key === 'lower'));

      expect(middle.data[2].value).toBeCloseTo(2);
      expect(upper.data[2].value).toBeCloseTo(3.633, 2);
      expect(lower.data[2].value).toBeCloseTo(0.367, 2);
    });

    it('computes RSI using Wilder smoothing', () => {
      const plots = plotsOf('rsi', { period: 2 }, candles([1, 2, 1, 2, 3]));

      const values = plots[0].data.map((point) => point.value);
      expect(values[0]).toBeUndefined();
      expect(values[1]).toBeUndefined();
      expect(values[2]).toBeCloseTo(50);
      expect(values[3]).toBeCloseTo(75);
      expect(values[4]).toBeCloseTo(87.5);
    });

    it('computes MACD line, signal and histogram', () => {
      const plots = plotsOf(
        'macd',
        { fast: 2, slow: 3, signal: 2 },
        candles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      );

      const macdPlot = must(plots.find((plot) => plot.key === 'macd'));
      const signalPlot = must(plots.find((plot) => plot.key === 'signal'));
      const histogramPlot = must(
        plots.find((plot) => plot.key === 'histogram')
      );

      expect(macdPlot.data[0].value).toBeUndefined();
      expect(macdPlot.data[1].value).toBeUndefined();
      expect(macdPlot.data[2].value).toBeCloseTo(0.5);
      expect(signalPlot.data[2].value).toBeUndefined();
      expect(signalPlot.data[3].value).toBeCloseTo(0.5);
      expect(histogramPlot.style).toBe('histogram');
      expect(histogramPlot.data[3].value).toBeCloseTo(0);
    });

    it('colors volume bars by candle direction', () => {
      const plots = plotsOf(
        'volume',
        {},
        candles([10, 10], [100, 200], [10, 11])
      );

      expect(plots[0].style).toBe('histogram');
      expect(plots[0].data[0].color).toBe('#26a69a');
      expect(plots[0].data[1].color).toBe('#ef5350');
      expect(plots[0].data[1].value).toBe(200);
    });
  });

  describe('computeSeries', () => {
    const cases: {
      id: IndicatorId;
      params: Record<string, number>;
      candles: PriceData[];
    }[] = [
      {
        id: 'sma',
        params: { period: 3 },
        candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5]),
      },
      {
        id: 'ema',
        params: { period: 3 },
        candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 10]),
      },
      {
        id: 'bb',
        params: { period: 3, stdDev: 2 },
        candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5]),
      },
      {
        id: 'rsi',
        params: { period: 2 },
        candles: SamplePriceBuilder.fromCloses([1, 2, 1, 2, 3]),
      },
      {
        id: 'macd',
        params: { fast: 2, slow: 3, signal: 2 },
        candles: SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      },
      {
        id: 'volume',
        params: {},
        candles: SamplePriceBuilder.fromCloses([10, 10], {
          volumes: [100, 200],
          opens: [10, 11],
        }),
      },
    ];

    it('returns index-aligned numeric values matching the chart plots', () => {
      for (const testCase of cases) {
        const series = seriesOf(testCase.id, testCase.params, testCase.candles);
        const plots = plotsOf(testCase.id, testCase.params, testCase.candles);

        expect(series.map((entry) => entry.key)).toEqual(
          plots.map((plot) => plot.key)
        );

        for (let i = 0; i < series.length; i++) {
          const values = series[i].values;
          const points = plots[i].data;
          expect(values).toHaveLength(testCase.candles.length);
          expect(values).toEqual(points.map((point) => point.value));
        }
      }
    });

    it('produces numeric values only, without rendering fields', () => {
      const series = seriesOf('sma', { period: 3 }, cases[0].candles);

      expect(series).toHaveLength(1);
      expect(Object.keys(series[0]).sort()).toEqual(['key', 'values']);
    });

    it('omits warm-up values instead of zero-filling', () => {
      const series = seriesOf(
        'sma',
        { period: 3 },
        SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5])
      );

      expect(series[0].values).toEqual([undefined, undefined, 2, 3, 4]);
    });

    it('preserves per-indicator expected values', () => {
      const smaSeries = seriesOf(
        'sma',
        { period: 3 },
        SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5])
      );
      expect(smaSeries[0].values[2]).toBeCloseTo(2);

      const rsiSeries = seriesOf(
        'rsi',
        { period: 2 },
        SamplePriceBuilder.fromCloses([1, 2, 1, 2, 3])
      );
      expect(rsiSeries[0].values[2]).toBeCloseTo(50);

      const macdSeries = seriesOf(
        'macd',
        { fast: 2, slow: 3, signal: 2 },
        SamplePriceBuilder.fromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      );
      const histogram = must(
        macdSeries.find((entry) => entry.key === 'histogram')
      );
      expect(histogram.values[3]).toBeCloseTo(0);
    });
  });

  describe('maxLookback', () => {
    it('returns zero when no indicator needs history', () => {
      expect(maxLookback([], '1m')).toBe(0);
      expect(maxLookback([instance('volume')], '1m')).toBe(0);
    });

    it('aggregates the largest lookback across instances and adds a margin', () => {
      const instances = [
        instance('sma', { period: 20 }),
        { ...instance('ema', { period: 50 }), key: 'ema-2' },
        { ...instance('volume'), key: 'volume-2' },
      ];

      expect(maxLookback(instances, '1m')).toBe(152 * 60 * 1000);
    });

    it('scales the warm-up span by the timeframe', () => {
      const instances = [instance('sma', { period: 20 })];

      expect(maxLookback(instances, '1h')).toBe(22 * 60 * 60 * 1000);
    });
  });

  describe('registry helpers', () => {
    it('creates instances with default params and a unique key', () => {
      const first = createIndicatorInstance('sma');
      const second = createIndicatorInstance('sma');

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      if (first.success && second.success) {
        expect(first.value.params).toEqual({ period: 20 });
        expect(second.value.key).not.toBe(first.value.key);
      }
    });

    it('returns error for unknown indicator', () => {
      const result = createIndicatorInstance(
        'unknown' as IndicatorInstance['indicatorId']
      );

      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('INDICATOR_NOT_FOUND');
    });

    it('groups definitions by pane', () => {
      const groups = getIndicatorGroups();

      expect(groups.overlays.map((def) => def.id)).toEqual([
        'sma',
        'ema',
        'bb',
      ]);
      expect(groups.oscillators.map((def) => def.id)).toEqual([
        'rsi',
        'macd',
        'volume',
      ]);
    });

    it('normalizes params against defaults and minimums', () => {
      const definition = must(getDefinition('sma'));

      expect(normalizeParams(definition, {})).toEqual({ period: 20 });
      expect(normalizeParams(definition, { period: 0 })).toEqual({ period: 1 });
    });
  });
});
