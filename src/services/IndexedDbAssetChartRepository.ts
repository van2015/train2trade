import { AssetSummary, PriceData } from '../types/asset';
import { Timeframe } from '../timeframe/Timeframe';
import { AssetChartRepository } from './AssetChartRepository';
import { openDatabase, ASSETS_STORE, SAMPLE_STORE } from './db';

interface StoredSample {
  assetId: string;
  timemili: number;
  sample: PriceData;
}

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

    const records: StoredSample[] = data.map(sample => ({
      assetId: id,
      timemili: new Date(sample.date).getTime(),
      sample,
    }));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([ASSETS_STORE, SAMPLE_STORE], 'readwrite');
      const assetStore = transaction.objectStore(ASSETS_STORE);
      const sampleStore = transaction.objectStore(SAMPLE_STORE);

      assetStore.put(summary);
      for (const record of records) {
        sampleStore.put(record);
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
    const samples = await this.getAllSamples(id);
    return samples.map(s => s.sample);
  }

  async deleteAsset(id: string): Promise<void> {
    const db = await openDatabase();
    const samples = await this.getAllSamples(id);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([ASSETS_STORE, SAMPLE_STORE], 'readwrite');
      const assetStore = transaction.objectStore(ASSETS_STORE);
      const sampleStore = transaction.objectStore(SAMPLE_STORE);

      assetStore.delete(id);
      for (const sample of samples) {
        sampleStore.delete([id, sample.timemili]);
      }

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  async getSamplesRange(assetId: string, from: number, to: number): Promise<PriceData[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_STORE);
      const request = store.getAll(IDBKeyRange.bound([assetId, from], [assetId, to]));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = (request.result as StoredSample[]).sort((a, b) => a.timemili - b.timemili);
        resolve(records.map(r => r.sample));
      };
    });
  }

  async getSampleAfter(assetId: string, time: number): Promise<PriceData | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_STORE);
      const request = store.openCursor(IDBKeyRange.lowerBound([assetId, time], true));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        resolve(cursor ? (cursor.value as StoredSample).sample : null);
      };
    });
  }

  async getSampleBefore(assetId: string, time: number): Promise<PriceData | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_STORE);
      const request = store.openCursor(IDBKeyRange.upperBound([assetId, time], true), 'prev');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        resolve(cursor ? (cursor.value as StoredSample).sample : null);
      };
    });
  }

  async getLastSample(assetId: string): Promise<PriceData | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_STORE);
      const index = store.index('assetId');
      const request = index.openCursor(IDBKeyRange.only(assetId), 'prev');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        resolve(cursor ? (cursor.value as StoredSample).sample : null);
      };
    });
  }

  private async getAllSamples(assetId: string): Promise<StoredSample[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SAMPLE_STORE, 'readonly');
      const store = transaction.objectStore(SAMPLE_STORE);
      const index = store.index('assetId');
      const request = index.getAll(IDBKeyRange.only(assetId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const records = (request.result as StoredSample[]).sort((a, b) => a.timemili - b.timemili);
        resolve(records);
      };
    });
  }
}

export { IndexedDbAssetChartRepository };
