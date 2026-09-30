import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { PriceData } from '../../src/shared/types/asset';
import { IndexedDbAssetChartRepository } from '../../src/shared/services/repositories/IndexedDbAssetChartRepository';
import { openDatabase, CHUNK_META_STORE, CHUNK_STORE } from '../../src/shared/services/db';

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

  describe('chunked storage', () => {
    async function readStore<T>(storeName: string): Promise<T[]> {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as T[]);
      });
    }

    it('persists at most 1000 samples per chunk with separate metadata', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');

      const chunks = await readStore<{ assetId: string; from: number; samples: PriceData[] }>(CHUNK_STORE);
      const metas = await readStore<{ assetId: string; from: number; to: number; count: number }>(CHUNK_META_STORE);

      expect(chunks).toHaveLength(3);
      expect(chunks.every(c => c.samples.length <= 1000)).toBe(true);
      expect(chunks.map(c => c.samples.length)).toEqual([1000, 1000, 500]);
      expect(metas).toHaveLength(3);
      expect(metas.every(m => m.assetId === summary.id && m.count <= 1000)).toBe(true);
    });

    it('reconstructs a dataset spanning multiple chunks', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      const data = await repo.getAssetData(summary.id);
      expect(data).toHaveLength(2500);
      expect(data[0]).toEqual(buildData(2500)[0]);
      expect(data[2499]).toEqual(buildData(2500)[2499]);
    });

    it('returns a range spanning a chunk boundary', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      const result = await repo.getSamplesRange(
        summary.id,
        START + 900 * MINUTE,
        START + 1100 * MINUTE
      );
      expect(result).toHaveLength(201);
      expect(result[0].date).toBe(new Date(START + 900 * MINUTE).toISOString());
      expect(result[result.length - 1].date).toBe(new Date(START + 1100 * MINUTE).toISOString());
    });

    it('returns the next sample across a chunk boundary', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      const sample = await repo.getSampleAfter(summary.id, START + 999 * MINUTE);
      expect(sample).not.toBeNull();
      expect(sample!.date).toBe(new Date(START + 1000 * MINUTE).toISOString());
    });

    it('returns the previous sample across a chunk boundary', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      const sample = await repo.getSampleBefore(summary.id, START + 1000 * MINUTE);
      expect(sample).not.toBeNull();
      expect(sample!.date).toBe(new Date(START + 999 * MINUTE).toISOString());
    });

    it('returns the last sample of the final chunk', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      const sample = await repo.getLastSample(summary.id);
      expect(sample).not.toBeNull();
      expect(sample!.date).toBe(new Date(START + 2499 * MINUTE).toISOString());
    });

    it('bulk deletes every chunk of an asset', async () => {
      const summary = await repo.saveAsset('Test', buildData(2500), '1m');
      await repo.deleteAsset(summary.id);

      expect(await readStore(CHUNK_STORE)).toEqual([]);
      expect(await readStore(CHUNK_META_STORE)).toEqual([]);
      expect(await repo.getAssetData(summary.id)).toEqual([]);
    });
  });
});
