import { describe, it, expect } from 'vitest';
import { PriceData } from '../../src/shared/types/asset';
import { resample } from '../../src/backtest/engine/Resampler';
import { PriceSeriesBuilder } from '../test-helpers/priceSeriesBuilder';

function bar(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): PriceData {
  return new PriceSeriesBuilder()
    .at(date)
    .open(open)
    .high(high)
    .low(low)
    .close(close)
    .volume(volume)
    .build()[0];
}

function minuteSeries(count: number, startMinute = 0): PriceData[] {
  const builder = new PriceSeriesBuilder();
  for (let i = 0; i < count; i++) {
    const minute = startMinute + i;
    const hh = String(Math.floor(minute / 60)).padStart(2, '0');
    const mm = String(minute % 60).padStart(2, '0');
    const price = 100 + i;
    builder
      .at(`2024-01-01T${hh}:${mm}:00Z`)
      .open(price)
      .high(price + 2)
      .low(price - 1)
      .close(price + 1)
      .volume(10);
  }
  return builder.build();
}

describe('resample', () => {
  it('aggregates OHLCV from a finer dataset to the target timeframe', () => {
    const dataset = minuteSeries(15);
    const result = resample(dataset, '5m');

    expect(result.hasFinerData).toBe(true);
    expect(result.bars).toHaveLength(3);
    expect(result.bars[0].date).toBe('2024-01-01T00:00:00Z');
    expect(result.bars[1].date).toBe('2024-01-01T00:05:00Z');
    expect(result.bars[2].date).toBe('2024-01-01T00:10:00Z');
  });

  it('computes open, high, low, close and volume correctly', () => {
    const dataset = [
      bar('2024-01-01T00:00:00Z', 10, 12, 9, 11, 100),
      bar('2024-01-01T00:01:00Z', 11, 15, 10, 14, 200),
      bar('2024-01-01T00:02:00Z', 14, 14, 8, 9, 300),
    ];
    const result = resample(dataset, '5m');

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]).toMatchObject({
      open: 10,
      high: 15,
      low: 8,
      close: 9,
      volume: 600,
    });
  });

  it('retains the constituent sub-bars in time order', () => {
    const dataset = minuteSeries(15);
    const result = resample(dataset, '5m');

    expect(result.bars[0].subBars).toHaveLength(5);
    expect(result.bars[0].subBars.map(sub => sub.date)).toEqual(
      dataset.slice(0, 5).map(candle => candle.date)
    );
  });

  it('exposes the finest bars for execution independently of aggregated bars', () => {
    const dataset = minuteSeries(15);
    const result = resample(dataset, '5m');

    expect(result.subBars).toBe(dataset);
  });

  it('aligns aggregated bars to timeframe boundaries', () => {
    const dataset = minuteSeries(6, 2);
    const result = resample(dataset, '5m');

    expect(result.bars[0].date).toBe('2024-01-01T00:00:00Z');
  });

  it('does not bridge a detected gap into a single bar', () => {
    const dataset = [
      bar('2024-01-01T00:00:00Z', 100, 101, 99, 100, 1),
      bar('2024-01-01T00:01:00Z', 100, 101, 99, 100, 1),
      bar('2024-01-01T00:04:00Z', 100, 101, 99, 100, 1),
    ];
    const result = resample(dataset, '5m');

    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].subBars).toHaveLength(2);
    expect(result.bars[1].subBars).toHaveLength(1);
    expect(new Date(result.bars[1].date).getTime()).toBeGreaterThan(
      new Date(result.bars[0].date).getTime()
    );
  });

  it('uses the dataset directly when the target timeframe equals the source', () => {
    const dataset = [
      bar('2024-01-01T00:00:00Z', 100, 101, 99, 100, 1),
      bar('2024-01-01T01:00:00Z', 100, 101, 99, 100, 1),
    ];
    const result = resample(dataset, '1h');

    expect(result.hasFinerData).toBe(false);
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0].date).toBe('2024-01-01T00:00:00Z');
    expect(result.bars[0].subBars).toEqual([dataset[0]]);
  });

  it('returns an empty result for an empty dataset', () => {
    const result = resample([], '1h');

    expect(result.bars).toEqual([]);
    expect(result.subBars).toEqual([]);
    expect(result.hasFinerData).toBe(false);
  });

  it('rejects a target timeframe finer than the dataset', () => {
    const dataset = [
      bar('2024-01-01T00:00:00Z', 100, 101, 99, 100, 1),
      bar('2024-01-01T01:00:00Z', 100, 101, 99, 100, 1),
    ];

    expect(() => resample(dataset, '5m')).toThrow();
  });
});
