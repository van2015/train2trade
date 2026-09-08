export const DB_NAME = 'AssetChartDB';
export const DB_VERSION = 4;
export const ASSETS_STORE = 'assets';
export const SAMPLE_INDEX_STORE = 'sampleIndexes';
export const SAMPLE_CHUNK_STORE = 'assetSamples';

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

      if (!db.objectStoreNames.contains(SAMPLE_INDEX_STORE)) {
        const store = db.createObjectStore(SAMPLE_INDEX_STORE, { keyPath: ['assetId', 'timemili'] });
        store.createIndex('assetId', 'assetId', { unique: false });
      }

      if (!db.objectStoreNames.contains(SAMPLE_CHUNK_STORE)) {
        const store = db.createObjectStore(SAMPLE_CHUNK_STORE, { keyPath: ['assetId', 'timemili'] });
        store.createIndex('assetId', 'assetId', { unique: false });
      }

      if (db.objectStoreNames.contains('assetPrices')) {
        db.deleteObjectStore('assetPrices');
      }
    };
  });
}
