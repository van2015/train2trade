import { describe, it, expect, beforeEach } from 'vitest';
import { PriceData, AssetSummary } from '../../src/shared/types/asset';
import { Timeframe } from '../../src/shared/timeframe/Timeframe';
import { AssetChartRepository } from '../../src/shared/services/repositories/AssetChartRepository';
import { AssetService } from '../../src/shared/services/AssetService';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

class FakeRepository implements AssetChartRepository {
  private dataByAsset = new Map<string, PriceData[]>();
  private summaries = new Map<string, AssetSummary>();

  setData(assetId: string, data: PriceData[]): void {
    this.dataByAsset.set(assetId, data);
  }

  async init(): Promise<void> {}
  async saveAsset(name: string, data: PriceData[], originalTimeframe: Timeframe): Promise<AssetSummary> {
    const id = crypto.randomUUID();
    const summary: AssetSummary = { id, name, createdAt: new Date(), originalTimeframe };
    this.summaries.set(id, summary);
    this.dataByAsset.set(id, data);
    return summary;
  }
  async getAssetSummaries(): Promise<AssetSummary[]> {
    return [...this.summaries.values()];
  }
  async getAssetData(id: string): Promise<PriceData[]> {
    return this.dataByAsset.get(id) ?? [];
  }
  async deleteAsset(id: string): Promise<void> {
    this.summaries.delete(id);
    this.dataByAsset.delete(id);
  }
  async getSamplesRange(assetId: string, from: number, to: number): Promise<PriceData[]> {
    const data = this.dataByAsset.get(assetId) ?? [];
    return data.filter(s => {
      const t = new Date(s.date).getTime();
      return t >= from && t <= to;
    });
  }
  async getSampleAfter(assetId: string, time: number): Promise<PriceData | null> {
    const data = this.sortedData(assetId);
    return data.find(s => new Date(s.date).getTime() > time) ?? null;
  }
  async getSampleBefore(assetId: string, time: number): Promise<PriceData | null> {
    const data = this.sortedData(assetId);
    let prev: PriceData | null = null;
    for (const s of data) {
      if (new Date(s.date).getTime() < time) prev = s;
      else break;
    }
    return prev;
  }
  async getLastSample(assetId: string): Promise<PriceData | null> {
    const data = this.sortedData(assetId);
    return data[data.length - 1] ?? null;
  }

  private sortedData(assetId: string): PriceData[] {
    return (this.dataByAsset.get(assetId) ?? [])
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
}

function buildSamples(count: number, startMs: number): PriceData[] {
  const data: PriceData[] = [];
  for (let i = 0; i < count; i++) {
    data.push({
      date: new Date(startMs + i * 60000).toISOString().replace('.000Z', 'Z'),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    });
  }
  return data;
}

describe('AssetService', () => {
  let repo: FakeRepository;
  let service: AssetService;

  beforeEach(() => {
    repo = new FakeRepository();
    service = new AssetService(repo);
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

    it('aligns buckets to the timeframe grid including a partial edge bucket', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(7)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      const result = service.aggregate(data, '5m', '1m');
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2024-01-01T00:00:00Z');
      expect(result[1].date).toBe('2024-01-01T00:05:00Z');
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

  describe('priceSample', () => {
    it('returns null when data is not loaded', () => {
      expect(service.priceSample('asset1', '1m', '1m')).toBeNull();
    });

    it('returns original data for same timeframe', () => {
      const data = [new SamplePriceBuilder().date('2024-01-01T00:00:00Z').open(100).high(105).low(98).close(102).volume(1000).buildOne()];
      repo.setData('asset1', data);
      service.addRangeData('asset1', data);
      const result = service.priceSample('asset1', '1m', '1m');
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

      repo.setData('asset1', originalData);
      service.addRangeData('asset1', originalData);

      const result1 = service.priceSample('asset1', '1m', '5m');
      const result2 = service.priceSample('asset1', '1m', '5m');

      expect(result1).toEqual(result2);
      expect(result1).toHaveLength(1);
    });

    it('computes on cache miss', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(2)
        .volume(1000)
        .buildSeries();
      repo.setData('asset1', data);
      service.addRangeData('asset1', data);
      const result = service.priceSample('asset1', '1m', '5m');
      expect(result).toHaveLength(1);
      expect(result![0].open).toBe(100);
    });
  });

  describe('addRangeData', () => {
    it('returns the interval spanning the samples', () => {
      const interval = service.addRangeData('asset1', buildSamples(3, 0));
      expect(interval).not.toBeNull();
      expect(interval!.from).toBe(0);
      expect(interval!.to).toBe(2 * 60000);
    });

    it('returns null for an empty window', () => {
      expect(service.addRangeData('asset1', [])).toBeNull();
    });

    it('accumulates fetched windows instead of replacing them', () => {
      service.addRangeData('asset1', buildSamples(3, 0));
      service.addRangeData('asset1', buildSamples(3, 10 * 60000));

      const result = service.priceSample('asset1', '1m', '1m');
      expect(result).toHaveLength(6);
      expect(result![0].date).toBe(new Date(0).toISOString().replace('.000Z', 'Z'));
      expect(result![5].date).toBe(new Date(12 * 60000).toISOString().replace('.000Z', 'Z'));
    });

    it('deduplicates overlapping samples by timestamp', () => {
      service.addRangeData('asset1', buildSamples(3, 0));
      service.addRangeData('asset1', buildSamples(3, 60000));

      const result = service.priceSample('asset1', '1m', '1m');
      expect(result).toHaveLength(4);
      expect(result!.map(sample => new Date(sample.date).getTime())).toEqual([
        0,
        60000,
        120000,
        180000,
      ]);
    });

    it('keeps accumulating fetched windows without dropping samples', () => {
      service.addRangeData('asset1', buildSamples(10000, 0));
      service.addRangeData('asset1', buildSamples(100, 10000 * 60000));

      const result = service.priceSample('asset1', '1m', '1m')!;
      expect(result).toHaveLength(10100);
      expect(new Date(result[0].date).getTime()).toBe(0);
      expect(new Date(result[result.length - 1].date).getTime()).toBe(10099 * 60000);
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
      repo.setData('asset1', data);
      service.addRangeData('asset1', data);
      service.priceSample('asset1', '1m', '5m');

      service.clearCache();

      expect(service.priceSample('asset1', '1m', '5m')).toBeNull();
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

      repo.setData('asset1', data1);
      repo.setData('asset2', data2);
      service.addRangeData('asset1', data1);
      service.addRangeData('asset2', data2);
      service.priceSample('asset1', '1m', '5m');
      service.priceSample('asset2', '1m', '5m');

      service.clearCache('asset1');

      expect(service.priceSample('asset1', '1m', '5m')).toBeNull();
      expect(service.priceSample('asset2', '1m', '5m')).not.toBeNull();
    });
  });

  describe('asset lifecycle', () => {
    it('init resolves without throwing', async () => {
      await expect(service.init()).resolves.toBeUndefined();
    });

    it('save persists a summary retrievable via getSummaries', async () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(3)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      const summary = await service.save('Test', data, '1m');
      expect(summary.id).toBeTruthy();
      expect(summary.name).toBe('Test');
      expect(summary.originalTimeframe).toBe('1m');

      const summaries = await service.getSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe(summary.id);
    });

    it('delete removes the summary and clears the cache', async () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(3)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      const summary = await service.save('Test', data, '1m');
      service.addRangeData(summary.id, data);
      service.priceSample(summary.id, '1m', '1m');

      await service.delete(summary.id);

      expect(await service.getSummaries()).toEqual([]);
      expect(service.priceSample(summary.id, '1m', '1m')).toBeNull();
    });
  });

  describe('getInitialRange', () => {
    it('returns a window of the last 500 candles of the original timeframe', async () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      repo.setData('asset1', data);
      const range = await service.getInitialRange('asset1', '1m');
      const last = new Date('2024-01-01T00:04:00Z').getTime();
      expect(range).not.toBeNull();
      expect(range!.to).toBe(last);
      expect(range!.from).toBe(last - 500 * 60000);
    });

    it('returns null for an asset with no data', async () => {
      expect(await service.getInitialRange('missing', '1m')).toBeNull();
    });
  });

  describe('fetchSamples', () => {
    it('returns samples within the given range', async () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(5)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();
      repo.setData('asset1', data);
      const from = new Date('2024-01-01T00:01:00Z').getTime();
      const to = new Date('2024-01-01T00:03:00Z').getTime();

      const result = await service.fetchSamples('asset1', from, to);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2024-01-01T00:01:00Z');
      expect(result[2].date).toBe('2024-01-01T00:03:00Z');
    });
  });
});
