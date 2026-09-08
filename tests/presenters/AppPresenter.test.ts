import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import AppPresenter from '../../src/presenters/AppPresenter';
import { AssetService } from '../../src/services/AssetService';

describe('AppPresenter', () => {
  let presenter: AppPresenter;

  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    presenter = AppPresenter.getInstance();
    AssetService.getInstance().clearCache();
    (presenter as any).assets = [];
    (presenter as any).selectedAssetId = null;
  });

  describe('getTimeframeData', () => {
    it('returns data for valid asset and timeframe', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        date: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      }));

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (AssetService.getInstance() as any).rawCache.set('asset1', data);

      const result = presenter.getTimeframeData('asset1', '1m');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(100);
    });

    it('returns null for non-existent asset', () => {
      const result = presenter.getTimeframeData('nonexistent', '1m');
      expect(result).toBeNull();
    });
  });
});
