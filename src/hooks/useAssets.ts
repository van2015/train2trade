import { useState, useEffect, useCallback } from 'react';
import { Asset, PriceData } from '../types/asset';
import {
  initDatabase,
  getAssets,
  saveAsset,
  deleteAsset,
  parseCSV,
  parseJSON,
} from '../services/storageService';

export function useAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase()
      .then(() => loadAssets())
      .catch((err) => {
        setError('Failed to initialize database');
        setLoading(false);
        console.error(err);
      });
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);
      const loaded = await getAssets();
      setAssets(loaded);
      setError(null);
    } catch (err) {
      setError('Failed to load assets');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addAsset = useCallback(async (name: string, file: File) => {
    try {
      setError(null);
      const content = await file.text();
      let data: PriceData[];

      if (file.name.endsWith('.csv')) {
        data = parseCSV(content);
      } else if (file.name.endsWith('.json')) {
        data = parseJSON(content);
      } else {
        throw new Error('Unsupported file format. Use CSV or JSON.');
      }

      const asset = await saveAsset(name || file.name.replace(/\.[^.]+$/, ''), data);
      setAssets((prev) => [...prev, asset]);
      return asset;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import file';
      setError(message);
      throw err;
    }
  }, []);

  const removeAsset = useCallback(async (id: string) => {
    try {
      setError(null);
      await deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError('Failed to delete asset');
      console.error(err);
      throw err;
    }
  }, []);

  return {
    assets,
    loading,
    error,
    addAsset,
    removeAsset,
    refreshAssets: loadAssets,
  };
}
