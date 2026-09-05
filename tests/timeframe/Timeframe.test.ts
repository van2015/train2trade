import { describe, it, expect } from 'vitest';
import { Timeframe } from '../../src/timeframe/Timeframe';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

describe('Timeframe.detect', () => {
  it('returns 1D for insufficient data', () => {
    const result = Timeframe.detect([]);
    expect(result.tf).toBe('1D');
    expect(result.confidence).toBe(0);
  });

  it('returns 1D for single candle', () => {
    const result = Timeframe.detect(
      [new SamplePriceBuilder().green(1).buildOne()]
    );
    expect(result.tf).toBe('1D');
    expect(result.confidence).toBe(0);
  });

  it('detects 1m timeframe from minute-spaced data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(5)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1m');
    expect(result.confidence).toBe(1);
  });

  it('detects 1m with gaps up to 2 minutes', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(3)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const candles = data.map((c, i) => ({
      ...c,
      date: `2024-01-01T00:${i === 0 ? '00' : i === 1 ? '02' : '04'}:00Z`,
    }));
    const result = Timeframe.detect(candles);
    expect(result.tf).toBe('1m');
  });

  it('detects 5m timeframe from 5-minute-spaced data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('5m')
      .count(6)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('5m');
    expect(result.confidence).toBe(1);
  });

  it('detects 5m with gaps 3-7 minutes', () => {
    const data = new SamplePriceBuilder()
      .timeframe('5m')
      .count(4)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('5m');
  });

  it('detects 15m timeframe from 15-minute-spaced data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('15m')
      .count(5)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('15m');
    expect(result.confidence).toBe(1);
  });

  it('detects 15m with gaps 8-20 minutes', () => {
    const data = new SamplePriceBuilder()
      .timeframe('15m')
      .count(4)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('15m');
  });

  it('detects 1h timeframe from hourly data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1h')
      .count(5)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1h');
    expect(result.confidence).toBe(1);
  });

  it('detects 1h with gaps 21-75 minutes', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1h')
      .count(4)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1h');
  });

  it('detects 4h timeframe', () => {
    const data = new SamplePriceBuilder()
      .timeframe('4h')
      .count(3)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('4h');
  });

  it('detects 1D timeframe from daily data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1D')
      .count(3)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1D');
    expect(result.confidence).toBe(1);
  });

  it('detects 1D with gaps 301-1500 minutes', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1D')
      .count(3)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1D');
  });

  it('calculates confidence correctly', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(5)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const candles = data.map((c, i) => ({
      ...c,
      date: `2024-01-01T00:${i < 4 ? `0${i}` : i}:00Z`,
    }));
    candles[4].date = '2024-01-01T00:10:00Z';
    const result = Timeframe.detect(candles);
    expect(result.tf).toBe('1m');
    expect(result.confidence).toBe(0.75);
  });

  it('calculates confidence with mixed gaps', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(6)
      .green(1)
      .buildSeries();
    const result = Timeframe.detect(data);
    expect(result.tf).toBe('1m');
    expect(result.confidence).toBe(1);
  });
});

describe('Timeframe.detectGaps', () => {
  it('returns empty for insufficient data', () => {
    expect(Timeframe.detectGaps([])).toEqual([]);
    expect(Timeframe.detectGaps([new SamplePriceBuilder().green(1).buildOne()])).toEqual([]);
  });

  it('returns empty for continuous 1m data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(5)
      .green(1)
      .buildSeries();
    expect(Timeframe.detectGaps(data)).toEqual([]);
  });

  it('finds a single gap in 1h data', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1h')
      .count(7)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const candles = data.map((c, i) => ({
      ...c,
      date: `2024-01-01T0${i < 5 ? `${i}` : i === 5 ? '05' : '08'}:00:00Z`,
    }));
    candles[5].date = '2024-01-01T07:00:00Z';
    const gaps = Timeframe.detectGaps(candles);
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toEqual({ startRow: 4, endRow: 5 });
  });

  it('identifies multiple gaps', () => {
    const data = [
      { date: '2024-01-01T00:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { date: '2024-01-01T01:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { date: '2024-01-01T04:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { date: '2024-01-01T05:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { date: '2024-01-01T09:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
      { date: '2024-01-01T10:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
    ];
    const gaps = Timeframe.detectGaps(data);
    expect(gaps.length).toBe(2);
    expect(gaps[0]).toEqual({ startRow: 1, endRow: 2 });
    expect(gaps[1]).toEqual({ startRow: 3, endRow: 4 });
  });

  it('finds gap in 1m data with missing candles', () => {
    const data = new SamplePriceBuilder()
      .timeframe('1m')
      .count(5)
      .startDate('2024-01-01T00:00:00Z')
      .green(1)
      .buildSeries();
    const candles = data.map((c, i) => ({
      ...c,
      date: i < 3 ? `2024-01-01T00:0${i}:00Z` : `2024-01-01T00:0${i === 3 ? '5' : '6'}:00Z`,
    }));
    candles[3].date = '2024-01-01T00:05:00Z';
    candles[4].date = '2024-01-01T00:06:00Z';
    const gaps = Timeframe.detectGaps(candles);
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toEqual({ startRow: 2, endRow: 3 });
  });
});
