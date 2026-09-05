import { describe, it, expect, beforeEach } from 'vitest';
import { AggregationService } from '../../src/services/AggregationService';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

describe('AggregationService', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = AggregationService.getInstance();
    service.clearCache();
  });

  describe('aggregate', () => {
    it('returns same data for same timeframe', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-01T00:01:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
      ];
      const result = service.aggregate(data, '1m', '1m');
      expect(result).toEqual(data);
    });

    it('returns same data when factor <= 1 (1D to 4H)', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
      ];
      const result = service.aggregate(data, '4h', '1D');
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
      const result = service.aggregate(data, '5m', '1m');
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
      const result = service.aggregate(data, '5m', '1m');
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
      const result = service.aggregate(data, '5m', '1m');
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
      const result = service.aggregate(data, '1D', '1h');
      expect(result).toHaveLength(1);
      expect(result[0].volume).toBe(240000);
    });
  });

  describe('getTimeframeData', () => {
    it('returns original data for same timeframe', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      const result = service.getTimeframeData('asset1', data, '1m', '1m');
      expect(result).toEqual(data);
    });

    it('uses cache on repeated calls', () => {
      const originalData = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      const result1 = service.getTimeframeData('asset1', originalData, '1m', '5m');
      const result2 = service.getTimeframeData('asset1', originalData, '1m', '5m');

      expect(result1).toBe(result2);
    });

    it('computes on cache miss', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(2)
        .volume(1000)
        .buildSeries();
      const result = service.getTimeframeData('asset1', data, '1m', '5m');
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(100);
    });

    it('returns cached data from previous call', () => {
      const originalData = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const cachedData = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(999).high(999).low(999).close(999).volume(9999).buildOne()];

      service.getTimeframeData('asset1', originalData, '1m', '5m');
      service.clearCache();
      const result = service.getTimeframeData('asset1', originalData, '1m', '5m');

      expect(result[0].open).not.toBe(999);
    });
  });

  describe('filterByRange', () => {
    it('returns exact range match', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
      ];
      const result = service.filterByRange(data, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2024-01-01T00:00:00Z');
      expect(result[1].date).toBe('2024-01-02T00:00:00Z');
    });

    it('returns empty array when range contains no data', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
      ];
      const result = service.filterByRange(data, '2024-01-05T00:00:00Z', '2024-01-10T00:00:00Z');
      expect(result).toHaveLength(0);
    });

    it('returns partial match', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
        new SamplePriceBuilder().date('2024-01-04T00:00:00Z').open(108).high(115).low(106).close(112).volume(1300).buildOne(),
      ];
      const result = service.filterByRange(data, '2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z');
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2024-01-02T00:00:00Z');
      expect(result[1].date).toBe('2024-01-03T00:00:00Z');
    });

    it('returns empty array for empty data', () => {
      const result = service.filterByRange([], '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
      expect(result).toHaveLength(0);
    });

    it('preserves chronological order', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
      ];
      const result = service.filterByRange(data, '2024-01-01T00:00:00Z', '2024-01-03T00:00:00Z');
      expect(result[0].date < result[1].date).toBe(true);
      expect(result[1].date < result[2].date).toBe(true);
    });
  });

  describe('filterByRangeWithBuffer', () => {
    it('extends range by 20% buffer', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
        new SamplePriceBuilder().date('2024-01-04T00:00:00Z').open(108).high(115).low(106).close(112).volume(1300).buildOne(),
        new SamplePriceBuilder().date('2024-01-05T00:00:00Z').open(112).high(118).low(110).close(115).volume(1400).buildOne(),
      ];
      const result = service.filterByRangeWithBuffer(data, '2024-01-02T00:00:00Z', '2024-01-04T00:00:00Z');
      expect(result.length).toBeGreaterThan(2);
    });

    it('clamps to dataset bounds at start', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
      ];
      const result = service.filterByRangeWithBuffer(data, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
      expect(result[0].date).toBe('2024-01-01T00:00:00Z');
    });

    it('clamps to dataset bounds at end', () => {
      const data = [
        new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne(),
        new SamplePriceBuilder().date('2024-01-02T00:00:00Z').open(102).high(108).low(100).close(105).volume(1200).buildOne(),
        new SamplePriceBuilder().date('2024-01-03T00:00:00Z').open(105).high(110).low(103).close(108).volume(1100).buildOne(),
      ];
      const result = service.filterByRangeWithBuffer(data, '2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z');
      expect(result[result.length - 1].date).toBe('2024-01-03T00:00:00Z');
    });

    it('returns empty array for empty data', () => {
      const result = service.filterByRangeWithBuffer([], '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
      expect(result).toHaveLength(0);
    });
  });

  describe('clearCache', () => {
    it('clears all cache when no assetId provided', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      service.getTimeframeData('asset1', data, '1m', '5m');
      service.clearCache();

      const result = service.getTimeframeData('asset1', data, '1m', '5m');
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(100);
    });

    it('clears specific asset cache', () => {
      const data1 = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const data2 = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(200)
        .green(1)
        .volume(1000)
        .buildSeries();

      service.getTimeframeData('asset1', data1, '1m', '5m');
      service.getTimeframeData('asset2', data2, '1m', '5m');

      service.clearCache('asset1');

      const result1 = service.getTimeframeData('asset1', data1, '1m', '5m');
      const result2 = service.getTimeframeData('asset2', data2, '1m', '5m');

      expect(result1[0].open).toBe(100);
      expect(result2[0].open).toBe(200);
    });
  });
});
