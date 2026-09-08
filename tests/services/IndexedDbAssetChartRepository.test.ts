import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { PriceData } from '../../src/types/asset';
import { IndexedDbAssetChartRepository } from '../../src/services/IndexedDbAssetChartRepository';

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

describe('IndexedDbAssetChartRepository', () => {
  let repo: IndexedDbAssetChartRepository;

  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    repo = IndexedDbAssetChartRepository.getInstance();
  });

  it('saveAsset persists an AssetSummary to the index store', async () => {
    const summary = await repo.saveAsset('Test', buildData(500), '1m');
    expect(summary.id).toBeTruthy();
    expect(summary.name).toBe('Test');
    expect(summary.originalTimeframe).toBe('1m');

    const summaries = await repo.getAssetSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(summary);
  });

  it('getAssetData reconstructs the full array from chunks', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const data = await repo.getAssetData(summary.id);
    expect(data).toHaveLength(1000);
    expect(data[500]).toEqual(buildData(1000)[500]);
  });

  it('returns chunk indexes sorted by time with correct metadata', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const indexes = await repo.getChunkIndexes(summary.id);
    expect(indexes).toHaveLength(2);
    expect(indexes[0].timemili).toBe(START);
    expect(indexes[0].sampleCount).toBe(500);
    expect(indexes[1].timemili).toBe(START + 500 * MINUTE);
  });

  it('deleteAsset removes the summary and all samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    await repo.deleteAsset(summary.id);
    expect(await repo.getAssetSummaries()).toEqual([]);
    expect(await repo.getAssetData(summary.id)).toEqual([]);
    expect(await repo.getChunkIndexes(summary.id)).toEqual([]);
  });

  it('multiple assets are listed independently', async () => {
    await repo.saveAsset('A', buildData(100), '1m');
    await repo.saveAsset('B', buildData(200), '5m');
    const summaries = await repo.getAssetSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries.map(s => s.name).sort()).toEqual(['A', 'B']);
  });
});
