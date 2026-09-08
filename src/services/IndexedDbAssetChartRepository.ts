import { AssetSummary, PriceData, SampleIndex } from '../types/asset';
import { Timeframe } from '../timeframe/Timeframe';
import { AssetChartRepository } from './AssetChartRepository';
import { openDatabase, ASSETS_STORE, SAMPLE_INDEX_STORE, SAMPLE_CHUNK_STORE } from './db';
import { splitIntoChunks } from './chunking';

class IndexedDbAssetChartRepository implements AssetChartRepository {
  private static instance: IndexedDbAssetChartRepository;

  private constructor() {}

  static getInstance(): IndexedDbAssetChartRepository {
    if (!IndexedDbAssetChartRepository.instance) {
      IndexedDbAssetChartRepository.instance = new IndexedDbAssetChartRepository();
    }
    return IndexedDbAssetChartRepository.instance;
  }

  async init(): Promise<void> {
    await openDatabase();
  }

  async saveAsset(
    name: string,
    data: PriceData[],
    originalTimeframe: Timeframe
  ): Promise<AssetSummary> {
    const db = await openDatabase();
    const id = crypto.randomUUID();
    const summary: AssetSummary = {
      id,
      name,
      createdAt: new Date(),
      originalTimeframe,
    };

    const chunks = splitIntoChunks(data);
    const indexes: SampleIndex[] = chunks.map(c => ({
      assetId: id,
      timemili: c.timemili,
      endTime: c.endTime,
      sampleCount: c.samples.length,
    }));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([ASSETS_STORE, SAMPLE_INDEX_STORE, SAMPLE_CHUNK_STORE], 'readwrite');
      const assetStore = transaction.objectStore(ASSETS_STORE);
      const indexStore = transaction.objectStore(SAMPLE_INDEX_STORE);
      const chunkStore = transaction.objectStore(SAMPLE_CHUNK_STORE);

      assetStore.put(summary);
      for (const index of indexes) {
        indexStore.put(index);
      }
      for (const chunk of chunks) {
        chunkStore.put({ assetId: id, timemili: chunk.timemili, samples: chunk.samples });
      }

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(summary);
    });
  }

  async getAssetSummaries(): Promise<AssetSummary[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(ASSETS_STORE, 'readonly');
      const store = transaction.objectStore(ASSETS_STORE);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const summaries: AssetSummary[] = request.result.map((asset: AssetSummary) => ({
          id: asset.id,
          name: asset.name,
          createdAt: asset.createdAt,
          originalTimeframe: asset.originalTimeframe || '1D',
        }));
        resolve(summaries);
      };
    });
  }

  async getAssetData(id: string): Promise<PriceData[]> {
    const indexes = await this.getChunkIndexes(id);
    const result: PriceData[] = [];

    for (const index of indexes) {
      const samples = await this.getChunkSamples(id, index.timemili);
      result.push(...samples);
    }

    return result;
  }

  async deleteAsset(id: string): Promise<void> {
    const db = await openDatabase();
    const chunkIndexes = await this.getChunkIndexes(id);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([ASSETS_STORE, SAMPLE_INDEX_STORE, SAMPLE_CHUNK_STORE], 'readwrite');
      const assetStore = transaction.objectStore(ASSETS_STORE);
      const indexStore = transaction.objectStore(SAMPLE_INDEX_STORE);
      const chunkStore = transaction.objectStore(SAMPLE_CHUNK_STORE);

      assetStore.delete(id);
      for (const index of chunkIndexes) {
        indexStore.delete([id, index.timemili]);
        chunkStore.delete([id, index.timemili]);
      }

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  async getChunkIndexes(assetId: string): Promise<SampleIndex[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_INDEX_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_INDEX_STORE);
      const index = store.index('assetId');
      const request = index.getAll(IDBKeyRange.only(assetId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = (request.result as SampleIndex[]).sort((a, b) => a.timemili - b.timemili);
        resolve(records);
      };
    });
  }

  async getChunkSamples(assetId: string, timemili: number): Promise<PriceData[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_CHUNK_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_CHUNK_STORE);
      const request = store.get([assetId, timemili]);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result as { assetId: string; timemili: number; samples: PriceData[] } | undefined;
        resolve(record?.samples ?? []);
      };
    });
  }
}

export { IndexedDbAssetChartRepository };
