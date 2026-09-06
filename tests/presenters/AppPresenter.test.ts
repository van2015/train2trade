import { describe, it, expect, beforeEach } from 'vitest';
import AppPresenter from '../../src/presenters/AppPresenter';
import { AggregationService } from '../../src/services/AggregationService';

describe('AppPresenter', () => {
  let presenter: AppPresenter;

  beforeEach(() => {
    presenter = AppPresenter.getInstance();
    AggregationService.getInstance().clearCache();
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
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];

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
