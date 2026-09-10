import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import AppPresenter from '../../src/presenters/AppPresenter';
import { AssetService } from '../../src/services/AssetService';
import { Interval } from '../../src/utils/Interval';

describe('AppPresenter', () => {
  let presenter: AppPresenter;

  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    presenter = AppPresenter.getInstance();
    AssetService.getInstance().clearCache();
    (presenter as any).assets = [];
    (presenter as any).selectedAssetId = null;
    (presenter as any).currentRange = null;
    (presenter as any).loadedRange = null;
  });

  describe('priceSample', () => {
    it('returns data for valid asset and timeframe', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        date: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString().replace('.000Z', 'Z'),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 1000,
      }));

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (AssetService.getInstance() as any).setRangeData('asset1', data);

      const result = presenter.priceSample('asset1', '1m');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(100);
    });

    it('returns null for non-existent asset', () => {
      const result = presenter.priceSample('nonexistent', '1m');
      expect(result).toBeNull();
    });
  });

  describe('hasCompleteData', () => {
    it('returns false when nothing is loaded', () => {
      expect(presenter.hasCompleteData(new Interval(0, 100))).toBe(false);
    });

    it('returns true when the interval is within the loaded range', () => {
      (presenter as any).loadedRange = new Interval(0, 1000);
      expect(presenter.hasCompleteData(new Interval(100, 900))).toBe(true);
      expect(presenter.hasCompleteData(new Interval(-1, 900))).toBe(false);
    });
  });
});
