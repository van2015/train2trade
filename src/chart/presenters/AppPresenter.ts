import {
  AssetSummary,
  ChartType,
  IndicatorInstance,
  PriceData,
  Timeframe as TimeframeType,
} from '../../shared/types/asset';
import { validateAndParse } from '../../shared/services/ValidationService';
import { AssetService } from '../../shared/services/AssetService';
import { PriceRetrievalStrategy, RangeStrategy } from '../../services/PriceRetrievalStrategy';
import { Interval } from '../../shared/utils/Interval';
import { ChartPresenter, ChartState } from './ChartPresenter';

export interface AppState {
  selectedAssetId: string | null;
  chartState: ChartState;
  chartType: ChartType;
  selectedTimeframe: TimeframeType;
  activeIndicators: IndicatorInstance[];
  error: string | null;
  warnings: string[];
}

class AppPresenter {
  private static instance: AppPresenter;

  private assetService = AssetService.getInstance();
  private strategy: PriceRetrievalStrategy = new RangeStrategy(1.0);
  private chartPresenter: ChartPresenter;
  private initPromise: Promise<void>;
  private assets: AssetSummary[] = [];
  private selectedAssetId: string | null = null;
  private currentRange: Interval | null = null;
  private loadedRange: Interval | null = null;
  private lastSampleTime: number | null = null;
  private error: string | null = null;
  private warnings: string[] = [];
  private listeners: Set<(state: AppState) => void> = new Set();

  get activeIndicators(): IndicatorInstance[] {
    return this.chartPresenter.getActiveIndicators();
  }

  set activeIndicators(value: IndicatorInstance[]) {
    this.chartPresenter.setActiveIndicators(value);
  }

  get selectedTimeframe(): TimeframeType {
    return this.chartPresenter.getState().selectedTimeframe;
  }

  set selectedTimeframe(value: TimeframeType) {
    this.chartPresenter.changeTimeframe(value);
  }

  loadIndicatorsFromStorage(): void {
    this.chartPresenter = new ChartPresenter({
      onStateChange: () => this.notify(),
    });
  }

  private constructor() {
    this.initPromise = this.assetService.init();
    this.chartPresenter = new ChartPresenter({
      onStateChange: () => this.notify(),
    });
  }

  static getInstance(): AppPresenter {
    if (!AppPresenter.instance) {
      AppPresenter.instance = new AppPresenter();
    }
    return AppPresenter.instance;
  }

  subscribe(fn: (state: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  unsubscribe(fn: (state: AppState) => void): void {
    this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn(this.getState()));
  }

  getState(): AppState {
    const chartState = this.chartPresenter.getState();
    return {
      selectedAssetId: this.selectedAssetId,
      chartState,
      chartType: chartState.chartType,
      selectedTimeframe: chartState.selectedTimeframe,
      activeIndicators: chartState.activeIndicators,
      error: this.error,
      warnings: this.warnings,
    };
  }

  getAssetList(): AssetSummary[] {
    return this.assets;
  }

  getChartPresenter(): ChartPresenter {
    return this.chartPresenter;
  }

  async init(): Promise<void> {
    await this.loadAssets();
  }

  private async loadAssets(): Promise<void> {
    try {
      await this.initPromise;
      this.assets = await this.assetService.getSummaries();
      this.notify();
    } catch (err) {
      this.error = 'Failed to load assets';
      this.notify();
    }
  }

  async importAsset(name: string, file: File): Promise<void> {
    try {
      this.error = null;
      this.warnings = [];
      const content = await file.text();

      const result = validateAndParse(content, file.name);

      if (!result.success) {
        throw new Error(result.error?.message || 'Validation failed');
      }

      if (result.warnings && result.warnings.length > 0) {
        this.warnings = result.warnings;
      }

      const assetName = name || file.name.replace(/\.[^.]+$/, '');
      await this.assetService.save(assetName, result.data!, result.detectedTimeframe!);
      await this.loadAssets();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to import file';
      this.notify();
      throw err;
    }
  }

  selectAsset(id: string): void {
    if (this.selectedAssetId && this.selectedAssetId !== id) {
      this.assetService.clearCache(this.selectedAssetId);
    }
    this.selectedAssetId = id;
    this.currentRange = null;
    this.loadedRange = null;
    this.lastSampleTime = null;
    this.notify();
    const asset = this.assets.find(a => a.id === id);
    if (!asset) return;
    this.assetService.getInitialRange(id, asset.originalTimeframe).then(interval => {
      if (!interval || this.selectedAssetId !== id) return;
      this.lastSampleTime = interval.to;
      this.requestRange(id, interval);
    });
  }

  async requestRange(assetId: string, interval: Interval): Promise<void> {
    try {
      this.currentRange = interval;
      const warmupMs = this.chartPresenter.getMaxLookback();
      const resolved = await this.strategy.getRange(assetId, interval, warmupMs);
      let from = resolved.from;
      let to = resolved.to;
      if (this.lastSampleTime !== null) {
        to = Math.min(to, this.lastSampleTime);
        from = Math.min(from, to);
      }
      const samples = await this.assetService.fetchSamples(assetId, from, to);
      this.loadedRange = this.assetService.addRangeData(assetId, samples);
      this.notify();
    } catch {
      this.error = 'Failed to load asset data';
      this.notify();
    }
  }

  async removeAsset(id: string): Promise<void> {
    try {
      this.error = null;
      await this.assetService.delete(id);
      if (this.selectedAssetId === id) {
        this.selectedAssetId = null;
        this.currentRange = null;
        this.loadedRange = null;
        this.lastSampleTime = null;
      }
      await this.loadAssets();
    } catch (err) {
      this.error = 'Failed to delete asset';
      this.notify();
      throw err;
    }
  }

  changeChartType(type: import('../../shared/types/asset').ChartType): void {
    this.chartPresenter.changeChartType(type);
  }

  changeTimeframe(tf: TimeframeType): void {
    this.chartPresenter.changeTimeframe(tf);
    if (
      this.selectedAssetId &&
      this.currentRange &&
      !this.chartPresenter.hasCompleteData(this.loadedRange, this.currentRange, this.lastSampleTime)
    ) {
      void this.requestRange(this.selectedAssetId, this.currentRange);
    }
  }

  getActiveIndicators(): import('../../shared/types/asset').IndicatorInstance[] {
    return this.chartPresenter.getActiveIndicators();
  }

  addIndicator(id: import('../../shared/types/asset').IndicatorId): Promise<void> {
    this.chartPresenter.addIndicator(id);
    return this.refreshRange();
  }

  removeIndicator(key: string): Promise<void> {
    this.chartPresenter.removeIndicator(key);
    return this.refreshRange();
  }

  updateIndicator(key: string, params: Record<string, number>): Promise<void> {
    this.chartPresenter.updateIndicator(key, params);
    return this.refreshRange();
  }

  private refreshRange(): Promise<void> {
    if (!this.selectedAssetId || !this.currentRange) return Promise.resolve();
    return this.requestRange(this.selectedAssetId, this.currentRange);
  }

  getCurrentRange(): Interval | null {
    return this.currentRange;
  }

  hasCompleteData(interval: Interval): boolean {
    return this.chartPresenter.hasCompleteData(this.loadedRange, interval, this.lastSampleTime);
  }

  priceSample(assetId: string, timeframe: TimeframeType): PriceData[] | null {
    const asset = this.assets.find(a => a.id === assetId);
    if (!asset) return null;

    return this.assetService.priceSample(assetId, asset.originalTimeframe, timeframe);
  }

  clearWarnings(): void {
    this.warnings = [];
    this.notify();
  }
}

export default AppPresenter;
