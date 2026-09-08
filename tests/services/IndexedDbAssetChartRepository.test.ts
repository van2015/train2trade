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

  it('getAssetData reconstructs the full array from samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const data = await repo.getAssetData(summary.id);
    expect(data).toHaveLength(1000);
    expect(data[500]).toEqual(buildData(1000)[500]);
    expect(data[999]).toEqual(buildData(1000)[999]);
  });

  it('getSamplesRange returns samples within a time range', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const result = await repo.getSamplesRange(summary.id, START + 100 * MINUTE, START + 900 * MINUTE);
    expect(result).toHaveLength(801);
    expect(result[0].date).toBe(new Date(START + 100 * MINUTE).toISOString());
    expect(result[result.length - 1].date).toBe(new Date(START + 900 * MINUTE).toISOString());
  });

  it('getSampleAfter returns the next sample after time', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const sample = await repo.getSampleAfter(summary.id, START + 499 * MINUTE);
    expect(sample).not.toBeNull();
    expect(sample!.date).toBe(new Date(START + 500 * MINUTE).toISOString());
  });

  it('getSampleBefore returns the previous sample before time', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const sample = await repo.getSampleBefore(summary.id, START + 500 * MINUTE);
    expect(sample).not.toBeNull();
    expect(sample!.date).toBe(new Date(START + 499 * MINUTE).toISOString());
  });

  it('getLastSample returns the most recent sample', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    const sample = await repo.getLastSample(summary.id);
    expect(sample).not.toBeNull();
    expect(sample!.date).toBe(new Date(START + 999 * MINUTE).toISOString());
  });

  it('returns null when there is no after/before/last sample', async () => {
    const summary = await repo.saveAsset('Test', buildData(5), '1m');
    expect(await repo.getSampleAfter(summary.id, START + 4 * MINUTE)).toBeNull();
    expect(await repo.getSampleBefore(summary.id, START)).toBeNull();
  });

  it('deleteAsset removes the summary and all samples', async () => {
    const summary = await repo.saveAsset('Test', buildData(1000), '1m');
    await repo.deleteAsset(summary.id);
    expect(await repo.getAssetSummaries()).toEqual([]);
    expect(await repo.getAssetData(summary.id)).toEqual([]);
    expect(await repo.getLastSample(summary.id)).toBeNull();
  });

  it('multiple assets are listed independently', async () => {
    await repo.saveAsset('A', buildData(100), '1m');
    await repo.saveAsset('B', buildData(200), '5m');
    const summaries = await repo.getAssetSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries.map(s => s.name).sort()).toEqual(['A', 'B']);
  });
});
