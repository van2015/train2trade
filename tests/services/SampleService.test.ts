import { describe, it, expect, beforeEach } from 'vitest';
import { PriceData, AssetSummary, SampleIndex } from '../../src/types/asset';
import { Timeframe } from '../../src/timeframe/Timeframe';
import { AssetChartRepository } from '../../src/services/AssetChartRepository';
import { SampleService } from '../../src/services/SampleService';
import { splitIntoChunks } from '../../src/services/chunking';

const START = Date.parse('2024-01-01T00:00:00Z');
const MINUTE = 60 * 1000;

function buildData(count: number): PriceData[] {
  const data: PriceData[] = [];
  for (let i = 0; i < count; i++) {
    data.push({
      date: new Date(START + i * MINUTE).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000,
    });
  }
  return data;
}

class FakeRepository implements AssetChartRepository {
  private assets = new Map<string, AssetSummary>();
  private indexes = new Map<string, SampleIndex[]>();
  private chunks = new Map<string, PriceData[]>();

  async init(): Promise<void> {}

  async saveAsset(name: string, data: PriceData[], originalTimeframe: Timeframe): Promise<AssetSummary> {
    const id = crypto.randomUUID();
    const summary: AssetSummary = { id, name, createdAt: new Date(), originalTimeframe };
    const chunks = splitIntoChunks(data);
    this.assets.set(id, summary);
    this.indexes.set(id, chunks.map(c => ({ assetId: id, timemili: c.timemili, endTime: c.endTime, sampleCount: c.samples.length })));
    for (const c of chunks) {
      this.chunks.set(`${id}:${c.timemili}`, c.samples);
    }
    return summary;
  }

  async getAssetSummaries(): Promise<AssetSummary[]> {
    return [...this.assets.values()];
  }

  async getAssetData(id: string): Promise<PriceData[]> {
    const result: PriceData[] = [];
    for (const index of await this.getChunkIndexes(id)) {
      result.push(...(await this.getChunkSamples(id, index.timemili)));
    }
    return result;
  }

  async deleteAsset(id: string): Promise<void> {
    this.assets.delete(id);
    for (const index of await this.getChunkIndexes(id)) {
      this.chunks.delete(`${id}:${index.timemili}`);
    }
    this.indexes.delete(id);
  }

  async getChunkIndexes(assetId: string): Promise<SampleIndex[]> {
    return (this.indexes.get(assetId) ?? []).slice().sort((a, b) => a.timemili - b.timemili);
  }

  async getChunkSamples(assetId: string, timemili: number): Promise<PriceData[]> {
    return this.chunks.get(`${assetId}:${timemili}`) ?? [];
  }
}

describe('SampleService', () => {
  let repo: FakeRepository;
  let service: SampleService;

  beforeEach(() => {
    repo = new FakeRepository();
    service = new SampleService(repo);
  });

  it('returns chunk indexes sorted by time with correct metadata', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const indexes = await service.getChunkIndexes(summary.id);
    expect(indexes).toHaveLength(2);
    expect(indexes[0].timemili).toBe(START);
    expect(indexes[0].sampleCount).toBe(500);
    expect(indexes[1].timemili).toBe(START + 500 * MINUTE);
  });

  it('returns samples within a time range', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const result = await service.range(summary.id, START + 100 * MINUTE, START + 900 * MINUTE);
    expect(result).toHaveLength(801);
    expect(result[0].date).toBe(new Date(START + 100 * MINUTE).toISOString());
    expect(result[result.length - 1].date).toBe(new Date(START + 900 * MINUTE).toISOString());
  });

  it('next returns the posterior chunk samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const samples = await service.next(summary.id, START + 499 * MINUTE);
    expect(samples).toHaveLength(500);
    expect(samples[0].date).toBe(new Date(START + 500 * MINUTE).toISOString());
  });

  it('before returns the anterior chunk samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const samples = await service.before(summary.id, START + 500 * MINUTE);
    expect(samples).toHaveLength(500);
    expect(samples[0].date).toBe(new Date(START).toISOString());
  });

  it('last returns the most recent chunk samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const samples = await service.last(summary.id);
    expect(samples).toHaveLength(500);
    expect(samples[0].date).toBe(new Date(START + 500 * MINUTE).toISOString());
  });

  it('returns empty when there is no next/before/last chunk', async () => {
    const summary = await repo.saveAsset('Test', buildData(300), '1m');
    expect(await service.next(summary.id, START + 250 * MINUTE)).toEqual([]);
    expect(await service.before(summary.id, START)).toEqual([]);
  });
});
