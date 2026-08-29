import { Asset, PriceData } from '../types/asset';

const DB_NAME = 'AssetChartDB';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function initDatabase(): Promise<IDBDatabase> {
  return openDatabase();
}

export async function saveAsset(name: string, data: PriceData[]): Promise<Asset> {
  const db = await openDatabase();
  const asset: Asset = {
    id: crypto.randomUUID(),
    name,
    data,
    createdAt: new Date(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(asset);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(asset);
  });
}

export async function getAssets(): Promise<Asset[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export function parseCSV(content: string): PriceData[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV must have header and at least one data row');
  }

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const requiredFields = ['date', 'open', 'high', 'low', 'close', 'volume'];
  const headerIndices: Record<string, number> = {};

  for (const field of requiredFields) {
    const index = header.findIndex(h => h.includes(field));
    if (index === -1) {
      throw new Error(`Missing required field: ${field}`);
    }
    headerIndices[field] = index;
  }

  const data: PriceData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length !== header.length) continue;

    data.push({
      date: values[headerIndices['date']],
      open: parseFloat(values[headerIndices['open']]),
      high: parseFloat(values[headerIndices['high']]),
      low: parseFloat(values[headerIndices['low']]),
      close: parseFloat(values[headerIndices['close']]),
      volume: parseFloat(values[headerIndices['volume']]),
    });
  }

  if (data.length === 0) {
    throw new Error('No valid data rows found');
  }

  return data;
}

export function parseJSON(content: string): PriceData[] {
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error('JSON must be an array of price data');
  }

  for (const item of parsed) {
    if (
      typeof item.date === 'undefined' ||
      typeof item.open === 'undefined' ||
      typeof item.high === 'undefined' ||
      typeof item.low === 'undefined' ||
      typeof item.close === 'undefined' ||
      typeof item.volume === 'undefined'
    ) {
      throw new Error('Each item must have date, open, high, low, close, volume');
    }
  }

  return parsed as PriceData[];
}
