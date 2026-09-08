import { AssetSummary, ChartType, PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';
import { IndexedDbAssetChartRepository } from '../services/IndexedDbAssetChartRepository';
import { validateAndParse } from '../services/ValidationService';
import { AggregationService } from '../services/AggregationService';

const TIMEFRAME_STORAGE_KEY = 'selectedTimeframe';

export interface AppState {
  selectedAssetId: string | null;
  chartType: ChartType;
  selectedTimeframe: TimeframeType;
  error: string | null;
  warnings: string[];
}

class AppPresenter {
  private static instance: AppPresenter;

  private repo = IndexedDbAssetChartRepository.getInstance();
  private initPromise: Promise<void>;
  private assets: AssetSummary[] = [];
  private assetDataCache: Map<string, PriceData[]> = new Map();
  private selectedAssetId: string | null = null;
  private chartType: ChartType = 'line';
  private selectedTimeframe: TimeframeType = '1D';
  private error: string | null = null;
  private warnings: string[] = [];
  private listeners: Set<(state: AppState) => void> = new Set();

  private constructor() {
    this.initPromise = this.repo.init();
    this.loadTimeframeFromStorage();
  }

  static getInstance(): AppPresenter {
    if (!AppPresenter.instance) {
      AppPresenter.instance = new AppPresenter();
    }
    return AppPresenter.instance;
  }

  private loadTimeframeFromStorage(): void {
    try {
      const stored = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
      if (stored && Timeframe.isValid(stored)) {
        this.selectedTimeframe = stored as TimeframeType;
      }
    } catch {
      this.selectedTimeframe = '1D';
    }
  }

  private saveTimeframeToStorage(): void {
    try {
      localStorage.setItem(TIMEFRAME_STORAGE_KEY, this.selectedTimeframe);
    } catch {
    }
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
    return {
      selectedAssetId: this.selectedAssetId,
      chartType: this.chartType,
      selectedTimeframe: this.selectedTimeframe,
      error: this.error,
      warnings: this.warnings,
    };
  }

  getAssetList(): AssetSummary[] {
    return this.assets;
  }

  async init(): Promise<void> {
    await this.loadAssets();
  }

  private async loadAssets(): Promise<void> {
    try {
      await this.initPromise;
      this.assets = await this.repo.getAssetSummaries();
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
      await this.repo.saveAsset(assetName, result.data!, result.detectedTimeframe!);
      await this.loadAssets();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to import file';
      this.notify();
      throw err;
    }
  }

  selectAsset(id: string): void {
    this.selectedAssetId = id;
    this.notify();
    this.loadAssetData(id);
  }

  private async loadAssetData(assetId: string): Promise<void> {
    if (this.assetDataCache.has(assetId)) return;

    try {
      const data = await this.repo.getAssetData(assetId);
      this.assetDataCache.set(assetId, data);
      this.notify();
    } catch (err) {
      this.error = 'Failed to load asset data';
      this.notify();
    }
  }

  async removeAsset(id: string): Promise<void> {
    try {
      this.error = null;
      await this.repo.deleteAsset(id);
      this.assetDataCache.delete(id);
      if (this.selectedAssetId === id) {
        this.selectedAssetId = null;
      }
      await this.loadAssets();
    } catch (err) {
      this.error = 'Failed to delete asset';
      this.notify();
      throw err;
    }
  }

  changeChartType(type: ChartType): void {
    this.chartType = type;
    this.notify();
  }

  changeTimeframe(tf: TimeframeType): void {
    this.selectedTimeframe = tf;
    this.saveTimeframeToStorage();
    this.notify();
  }

  getTimeframeData(assetId: string, timeframe: TimeframeType): PriceData[] | null {
    const data = this.assetDataCache.get(assetId);
    if (!data) return null;

    const asset = this.assets.find(a => a.id === assetId);
    if (!asset) return null;

    return AggregationService.getInstance().getTimeframeData(
      assetId,
      data,
      asset.originalTimeframe,
      timeframe
    );
  }

  clearWarnings(): void {
    this.warnings = [];
    this.notify();
  }
}

export default AppPresenter;
