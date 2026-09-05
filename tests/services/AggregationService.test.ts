import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  aggregate,
  getCachedData,
  setCachedData,
  clearCache,
  getAggregatedData,
} from '../../src/services/AggregationService';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

describe('AggregationService', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    clearCache();
  });

  describe('aggregate', () => {
    it('returns same data for same timeframe', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-01T00:01:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
      ];
      const result = aggregate(data, '1m', '1m');
      expect(result).toEqual(data);
    });

    it('returns same data when factor <= 1 (1D to 4H)', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
      ];
      const result = aggregate(data, '4h', '1D');
      expect(result).toEqual(data);
    });

    it('merges 5x 1m into 5m correctly', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(2)
        .volume(1000)
        .buildSeries();
      const result = aggregate(data, '5m', '1m');
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(100);
      expect(result[0].date).toBe('2024-01-01T00:00:00Z');
      expect(result[0].volume).toBe(5000);
    });

    it('discards incomplete chunk', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(7)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const result = aggregate(data, '5m', '1m');
      expect(result).toHaveLength(1);
    });

    it('aggregates multiple complete chunks', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(10)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const result = aggregate(data, '5m', '1m');
      expect(result).toHaveLength(2);
    });

    it('aggregates 1h to 1D correctly', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1h')
        .count(24)
        .startDate('2024-01-01T00:00:00Z')
        .startPrice(100)
        .green(1)
        .volume(10000)
        .buildSeries();
      const result = aggregate(data, '1D', '1h');
      expect(result).toHaveLength(1);
      expect(result[0].volume).toBe(240000);
    });
  });

  describe('caching', () => {
    it('getCachedData returns undefined for missing asset', () => {
      expect(getCachedData('nonexistent', '1m')).toBeUndefined();
    });

    it('setCachedData and getCachedData roundtrip', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      setCachedData('asset1', '1m', data);
      expect(getCachedData('asset1', '1m')).toEqual(data);
    });

    it('setCachedData does not affect different asset', () => {
      const data1 = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      const data2 = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(200).high(205).low(198).close(202).volume(2000).buildOne()];
      setCachedData('asset1', '1m', data1);
      setCachedData('asset2', '1m', data2);
      expect(getCachedData('asset1', '1m')).toEqual(data1);
      expect(getCachedData('asset2', '1m')).toEqual(data2);
    });

    it('setCachedData does not affect different timeframe', () => {
      const data1m = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      const data5m = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(5000).buildOne()];
      setCachedData('asset1', '1m', data1m);
      setCachedData('asset1', '5m', data5m);
      expect(getCachedData('asset1', '1m')).toEqual(data1m);
      expect(getCachedData('asset1', '5m')).toEqual(data5m);
    });

    it('clearCache removes specific asset', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      setCachedData('asset1', '1m', data);
      setCachedData('asset2', '1m', data);
      clearCache('asset1');
      expect(getCachedData('asset1', '1m')).toBeUndefined();
      expect(getCachedData('asset2', '1m')).toEqual(data);
    });

    it('clearCache without assetId clears all', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      setCachedData('asset1', '1m', data);
      setCachedData('asset2', '1m', data);
      clearCache();
      expect(getCachedData('asset1', '1m')).toBeUndefined();
      expect(getCachedData('asset2', '1m')).toBeUndefined();
    });
  });

  describe('getAggregatedData', () => {
    it('returns original data for same timeframe', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      const result = getAggregatedData('asset1', data, '1m', '1m');
      expect(result).toEqual(data);
    });

    it('uses cache when available', () => {
      const originalData = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const cachedData = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(999).high(999).low(999).close(999).volume(9999).buildOne()];
      setCachedData('asset1', '5m', cachedData);
      const result = getAggregatedData('asset1', originalData, '1m', '5m');
      expect(result).toEqual(cachedData);
    });

    it('computes and caches on miss', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(2)
        .volume(1000)
        .buildSeries();
      const result = getAggregatedData('asset1', data, '1m', '5m');
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(100);
      expect(getCachedData('asset1', '5m')).toEqual(result);
    });
  });
});
