import { AssetSummary, PriceData } from '../types/asset';
import { Timeframe } from '../timeframe/Timeframe';
import { AssetChartRepository } from './AssetChartRepository';
import {
  openDatabase,
  ASSETS_STORE,
  CHUNK_META_STORE,
  CHUNK_STORE,
  CHUNK_SIZE,
} from './db';

interface ChunkMeta {
  assetId: string;
  from: number;
  to: number;
  count: number;
}

interface StoredChunk {
  assetId: string;
  from: number;
  samples: PriceData[];
}

function timeOf(sample: PriceData): number {
  return new Date(sample.date).getTime();
}

function assetRange(assetId: string): IDBKeyRange {
  return IDBKeyRange.bound([assetId], [assetId, []]);
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

    const metas: ChunkMeta[] = [];
    const chunks: StoredChunk[] = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const samples = data.slice(i, i + CHUNK_SIZE);
      const from = timeOf(samples[0]);
      const to = timeOf(samples[samples.length - 1]);
      metas.push({ assetId: id, from, to, count: samples.length });
      chunks.push({ assetId: id, from, samples });
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        [ASSETS_STORE, CHUNK_META_STORE, CHUNK_STORE],
        'readwrite'
      );
      transaction.objectStore(ASSETS_STORE).put(summary);
      const metaStore = transaction.objectStore(CHUNK_META_STORE);
      const chunkStore = transaction.objectStore(CHUNK_STORE);

      for (let i = 0; i < metas.length; i++) {
        metaStore.put(metas[i]);
        chunkStore.put(chunks[i]);
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
    const metas = await this.getAllChunkMetas(id);
    const chunks = await this.getChunks(id, metas.map(meta => meta.from));

    const result: PriceData[] = [];
    for (const chunk of chunks) {
      if (chunk) result.push(...chunk.samples);
    }
    return result;
  }

  async deleteAsset(id: string): Promise<void> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        [ASSETS_STORE, CHUNK_META_STORE, CHUNK_STORE],
        'readwrite'
      );
      const range = assetRange(id);

      transaction.objectStore(ASSETS_STORE).delete(id);
      transaction.objectStore(CHUNK_META_STORE).delete(range);
      transaction.objectStore(CHUNK_STORE).delete(range);

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
    });
  }

  async getSamplesRange(assetId: string, from: number, to: number): Promise<PriceData[]> {
    const metas = await this.getChunkMetas(assetId, from, to);
    const chunks = await this.getChunks(assetId, metas.map(meta => meta.from));

    const result: PriceData[] = [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      for (const sample of chunk.samples) {
        const time = timeOf(sample);
        if (time >= from && time <= to) result.push(sample);
      }
    }
    return result;
  }

  async getSampleAfter(assetId: string, time: number): Promise<PriceData | null> {
    const containing = await this.getChunkMetaAtOrBefore(assetId, time);
    if (containing) {
      const [chunk] = await this.getChunks(assetId, [containing.from]);
      if (chunk) {
        const found = chunk.samples.find(sample => timeOf(sample) > time);
        if (found) return found;
      }
    }

    const next = await this.getFirstChunkMetaAfter(assetId, time);
    if (next) {
      const [chunk] = await this.getChunks(assetId, [next.from]);
      if (chunk && chunk.samples.length > 0) return chunk.samples[0];
    }
    return null;
  }

  async getSampleBefore(assetId: string, time: number): Promise<PriceData | null> {
    const containing = await this.getChunkMetaAtOrBefore(assetId, time);
    if (containing) {
      const [chunk] = await this.getChunks(assetId, [containing.from]);
      if (chunk) {
        for (let i = chunk.samples.length - 1; i >= 0; i--) {
          if (timeOf(chunk.samples[i]) < time) return chunk.samples[i];
        }
      }

      const previous = await this.getLastChunkMetaBefore(assetId, containing.from);
      if (previous) {
        const [previousChunk] = await this.getChunks(assetId, [previous.from]);
        if (previousChunk && previousChunk.samples.length > 0) {
          return previousChunk.samples[previousChunk.samples.length - 1];
        }
      }
    }
    return null;
  }

  async getLastSample(assetId: string): Promise<PriceData | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      const request = store.openCursor(assetRange(assetId), 'prev');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        const chunk = cursor ? (cursor.value as StoredChunk) : null;
        resolve(
          chunk && chunk.samples.length > 0
            ? chunk.samples[chunk.samples.length - 1]
            : null
        );
      };
    });
  }

  private async getChunkMetas(assetId: string, from: number, to: number): Promise<ChunkMeta[]> {
    const containing = await this.getChunkMetaAtOrBefore(assetId, from);
    const startFrom = containing ? containing.from : from;

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_META_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_META_STORE);
      const request = store.getAll(IDBKeyRange.bound([assetId, startFrom], [assetId, to]));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as ChunkMeta[]);
    });
  }

  private async getAllChunkMetas(assetId: string): Promise<ChunkMeta[]> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_META_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_META_STORE);
      const request = store.getAll(assetRange(assetId));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as ChunkMeta[]);
    });
  }

  private async getChunkMetaAtOrBefore(assetId: string, time: number): Promise<ChunkMeta | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_META_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_META_STORE);
      const request = store.openCursor(IDBKeyRange.upperBound([assetId, time]), 'prev');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        const meta = cursor ? (cursor.value as ChunkMeta) : null;
        resolve(meta && meta.assetId === assetId ? meta : null);
      };
    });
  }

  private async getFirstChunkMetaAfter(assetId: string, time: number): Promise<ChunkMeta | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_META_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_META_STORE);
      const request = store.openCursor(IDBKeyRange.lowerBound([assetId, time], true));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        const meta = cursor ? (cursor.value as ChunkMeta) : null;
        resolve(meta && meta.assetId === assetId ? meta : null);
      };
    });
  }

  private async getLastChunkMetaBefore(assetId: string, from: number): Promise<ChunkMeta | null> {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_META_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_META_STORE);
      const request = store.openCursor(IDBKeyRange.upperBound([assetId, from], true), 'prev');

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        const meta = cursor ? (cursor.value as ChunkMeta) : null;
        resolve(meta && meta.assetId === assetId ? meta : null);
      };
    });
  }

  private async getChunks(
    assetId: string,
    froms: number[]
  ): Promise<(StoredChunk | undefined)[]> {
    if (froms.length === 0) return [];
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(CHUNK_STORE, 'readonly');
      const store = transaction.objectStore(CHUNK_STORE);
      const results: (StoredChunk | undefined)[] = new Array(froms.length);
      let failed = false;

      froms.forEach((from, index) => {
        const request = store.get([assetId, from]);
        request.onsuccess = () => {
          results[index] = request.result as StoredChunk | undefined;
        };
        request.onerror = () => {
          failed = true;
          reject(request.error);
        };
      });

      transaction.oncomplete = () => {
        if (!failed) resolve(results);
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export { IndexedDbAssetChartRepository };
