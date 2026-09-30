import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import AppPresenter from '../../src/chart/presenters/AppPresenter';
import { AssetService } from '../../src/shared/services/AssetService';
import { Interval } from '../../src/shared/utils/Interval';

describe('AppPresenter', () => {
  let presenter: AppPresenter;

  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    localStorage.clear();
    vi.restoreAllMocks();
    presenter = AppPresenter.getInstance();
    AssetService.getInstance().clearCache();
    (presenter as any).assets = [];
    (presenter as any).selectedAssetId = null;
    (presenter as any).currentRange = null;
    (presenter as any).loadedRange = null;
    (presenter as any).lastSampleTime = null;
    (presenter as any).activeIndicators = [];
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
      (AssetService.getInstance() as any).addRangeData('asset1', data);

      const result = presenter.priceSample('asset1', '1m');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(100);
    });

    it('returns null for non-existent asset', () => {
      const result = presenter.priceSample('nonexistent', '1m');
      expect(result).toBeNull();
    });

    it('re-aggregates the retained window across timeframe changes without refetching', () => {
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
      AssetService.getInstance().addRangeData('asset1', data);

      expect(presenter.priceSample('asset1', '1m')).toHaveLength(100);
      presenter.changeTimeframe('5m');
      const aggregated = presenter.priceSample('asset1', '5m');
      expect(aggregated).not.toBeNull();
      expect(aggregated).toHaveLength(20);
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

    it('requires indicator warm-up before the viewport start', () => {
      (presenter as any).selectedTimeframe = '1m';
      (presenter as any).activeIndicators = [
        { key: 'sma-1', indicatorId: 'sma', params: { period: 20 } },
      ];
      (presenter as any).loadedRange = new Interval(0, 1000 * 60000);

      expect(presenter.hasCompleteData(new Interval(1300000, 2000000))).toBe(false);
      expect(presenter.hasCompleteData(new Interval(1400000, 2000000))).toBe(true);
    });

    it('treats a viewport beyond the last sample as complete once the tail is loaded', () => {
      (presenter as any).lastSampleTime = 1000;
      (presenter as any).loadedRange = new Interval(0, 1000);

      expect(presenter.hasCompleteData(new Interval(2000, 5000))).toBe(true);
      expect(presenter.hasCompleteData(new Interval(500, 5000))).toBe(true);
    });

    it('clamps a fetch beyond the last sample to the available tail', async () => {
      const lastSample = {
        date: new Date(1000).toISOString(),
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      };
      const fetchSpy = vi
        .spyOn(AssetService.getInstance(), 'fetchSamples')
        .mockResolvedValue([lastSample]);
      (presenter as any).lastSampleTime = 1000;

      await presenter.requestRange('asset1', new Interval(2000, 5000));

      expect(fetchSpy).toHaveBeenCalledWith('asset1', expect.any(Number), 1000);
      expect((presenter as any).loadedRange).not.toBeNull();
    });
  });

  describe('indicators', () => {
    it('adds an indicator with default params', async () => {
      await presenter.addIndicator('sma');

      const active = presenter.getActiveIndicators();
      expect(active).toHaveLength(1);
      expect(active[0].indicatorId).toBe('sma');
      expect(active[0].params).toEqual({ period: 20 });
    });

    it('allows multiple instances of the same indicator', async () => {
      await presenter.addIndicator('sma');
      await presenter.addIndicator('sma');

      const active = presenter.getActiveIndicators();
      expect(active).toHaveLength(2);
      expect(active[0].key).not.toBe(active[1].key);
    });

    it('removes an indicator by key', async () => {
      await presenter.addIndicator('rsi');
      const key = presenter.getActiveIndicators()[0].key;

      await presenter.removeIndicator(key);

      expect(presenter.getActiveIndicators()).toHaveLength(0);
    });

    it('updates indicator params with normalization', async () => {
      await presenter.addIndicator('sma');
      const key = presenter.getActiveIndicators()[0].key;

      await presenter.updateIndicator(key, { period: 50 });

      expect(presenter.getActiveIndicators()[0].params).toEqual({ period: 50 });
    });

    it('persists active indicators to localStorage', async () => {
      await presenter.addIndicator('macd');

      const stored = JSON.parse(localStorage.getItem('activeIndicators')!);
      expect(stored).toHaveLength(1);
      expect(stored[0].indicatorId).toBe('macd');
    });

    it('discards invalid stored entries on load', () => {
      localStorage.setItem(
        'activeIndicators',
        JSON.stringify([
          { key: 'k1', indicatorId: 'sma', params: { period: 50 } },
          { key: 'k2', indicatorId: 'unknown', params: {} },
          { indicatorId: 'rsi', params: {} },
          null,
        ])
      );

      (presenter as any).loadIndicatorsFromStorage();

      const active = presenter.getActiveIndicators();
      expect(active).toHaveLength(1);
      expect(active[0].params).toEqual({ period: 50 });
    });

    it('re-requests the current range when the active set changes', async () => {
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).currentRange = new Interval(1000, 2000);
      const spy = vi.spyOn(presenter, 'requestRange').mockResolvedValue(undefined);

      await presenter.addIndicator('sma');

      expect(spy).toHaveBeenCalledWith('asset1', new Interval(1000, 2000));
    });
  });
});
