export const DB_NAME = 'AssetChartDB';
export const DB_VERSION = 6;
export const ASSETS_STORE = 'assets';
export const CHUNK_META_STORE = 'chunkMeta';
export const CHUNK_STORE = 'chunks';
export const CHUNK_SIZE = 1000;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction!;

      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      } else {
        const store = tx.objectStore(ASSETS_STORE);
        if (!store.indexNames.contains('originalTimeframe')) {
          store.createIndex('originalTimeframe', 'originalTimeframe', { unique: false });
        }
      }

      for (const legacy of ['samples', 'sampleIndexes', 'assetSamples']) {
        if (db.objectStoreNames.contains(legacy)) {
          db.deleteObjectStore(legacy);
        }
      }

      if (!db.objectStoreNames.contains(CHUNK_META_STORE)) {
        db.createObjectStore(CHUNK_META_STORE, { keyPath: ['assetId', 'from'] });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE, { keyPath: ['assetId', 'from'] });
      }
    };
  });
}
