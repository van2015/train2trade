import { describe, it, expect, beforeEach } from 'vitest';
import AppPresenter from '../../src/presenters/AppPresenter';
import { AggregationService } from '../../src/services/AggregationService';
import { SamplePriceBuilder } from '../test-helpers/samplePriceBuilder';

describe('AppPresenter', () => {
  let presenter: AppPresenter;

  beforeEach(() => {
    presenter = AppPresenter.getInstance();
    AggregationService.getInstance().clearCache();
    (presenter as any).assets = [];
    (presenter as any).selectedAssetId = null;
    (presenter as any).visibleRange = null;
    (presenter as any).visibleData = [];
  });

  describe('onViewportChange', () => {
    it('skips filtering when dataset has fewer than 5000 rows', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(100)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).selectedTimeframe = '1m';

      presenter.onViewportChange({
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-01T00:50:00Z',
      });

      const state = presenter.getState();
      expect(state.visibleRange).toBeNull();
      expect(state.visibleData).toHaveLength(0);
    });

    it('applies filtering when dataset has 5000 or more rows', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(6000)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).selectedTimeframe = '1m';

      presenter.onViewportChange({
        from: data[1000].date,
        to: data[2000].date,
      });

      const state = presenter.getState();
      expect(state.visibleRange).not.toBeNull();
      expect(state.visibleData.length).toBeGreaterThan(0);
      expect(state.visibleData.length).toBeLessThan(6000);
    });
  });

  describe('getChartData', () => {
    it('returns visibleData when viewport is set', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(6000)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).selectedTimeframe = '1m';

      presenter.onViewportChange({
        from: data[1000].date,
        to: data[2000].date,
      });

      const chartData = presenter.getChartData('asset1', '1m');
      expect(chartData).toBe(presenter.getState().visibleData);
    });

    it('returns full data when no viewport is set', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(100)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).selectedTimeframe = '1m';

      const chartData = presenter.getChartData('asset1', '1m');
      expect(chartData).toHaveLength(100);
      expect(chartData![0].date).toBe(data[0].date);
      expect(chartData![99].date).toBe(data[99].date);
    });
  });

  describe('resetViewport', () => {
    it('clears visibleRange and visibleData', () => {
      const data = new SamplePriceBuilder()
        .timeframe('1m')
        .count(6000)
        .startPrice(100)
        .green(1)
        .volume(1000)
        .buildSeries();

      (presenter as any).assets = [
        { id: 'asset1', name: 'Test', data, createdAt: new Date(), originalTimeframe: '1m' }
      ];
      (presenter as any).selectedAssetId = 'asset1';
      (presenter as any).selectedTimeframe = '1m';

      presenter.onViewportChange({
        from: data[1000].date,
        to: data[2000].date,
      });

      presenter.resetViewport();

      const state = presenter.getState();
      expect(state.visibleRange).toBeNull();
      expect(state.visibleData).toHaveLength(0);
    });
  });
});
