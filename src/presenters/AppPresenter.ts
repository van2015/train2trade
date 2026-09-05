import { Asset, ChartType, PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';
import { getAssets, saveAsset, deleteAsset } from '../services/storageService';
import { validateAndParse } from '../services/ValidationService';
import { AggregationService } from '../services/AggregationService';

const TIMEFRAME_STORAGE_KEY = 'selectedTimeframe';

export interface AppState {
  assets: Asset[];
  selectedAssetId: string | null;
  chartType: ChartType;
  selectedTimeframe: TimeframeType;
  error: string | null;
  warnings: string[];
  visibleRange: { from: string; to: string } | null;
  visibleData: PriceData[];
}

class AppPresenter {
  private static instance: AppPresenter;

  private assets: Asset[] = [];
  private selectedAssetId: string | null = null;
  private chartType: ChartType = 'line';
  private selectedTimeframe: TimeframeType = '1D';
  private error: string | null = null;
  private warnings: string[] = [];
  private listeners: Set<(state: AppState) => void> = new Set();
  private visibleRange: { from: string; to: string } | null = null;
  private visibleData: PriceData[] = [];

  private constructor() {
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
      assets: this.assets,
      selectedAssetId: this.selectedAssetId,
      chartType: this.chartType,
      selectedTimeframe: this.selectedTimeframe,
      error: this.error,
      warnings: this.warnings,
      visibleRange: this.visibleRange,
      visibleData: this.visibleData,
    };
  }

  async loadAssets(): Promise<void> {
    try {
      this.assets = await getAssets();
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
      await saveAsset(assetName, result.data!, result.detectedTimeframe!);
      await this.loadAssets();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to import file';
      this.notify();
      throw err;
    }
  }

  selectAsset(id: string): void {
    this.selectedAssetId = id;
    this.resetViewport();
    this.notify();
  }

  async removeAsset(id: string): Promise<void> {
    try {
      this.error = null;
      await deleteAsset(id);
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
    this.resetViewport();
    this.notify();
  }

  getTimeframeData(assetId: string, timeframe: TimeframeType): PriceData[] | null {
    const asset = this.assets.find(a => a.id === assetId);
    if (!asset) return null;

    return AggregationService.getInstance().getTimeframeData(
      assetId,
      asset.data,
      asset.originalTimeframe,
      timeframe
    );
  }

  getChartData(assetId: string, timeframe: TimeframeType): PriceData[] | null {
    if (this.visibleRange && this.visibleData.length > 0) {
      return this.visibleData;
    }
    return this.getTimeframeData(assetId, timeframe);
  }

  onViewportChange(range: { from: string; to: string }): void {
    if (!this.selectedAssetId) return;

    const asset = this.assets.find(a => a.id === this.selectedAssetId);
    if (!asset) return;

    const visible = AggregationService.getInstance().getVisibleData(
      this.selectedAssetId,
      asset.data,
      asset.originalTimeframe,
      this.selectedTimeframe,
      range
    );

    this.visibleRange = visible ? range : null;
    this.visibleData = visible ?? [];
    this.notify();
  }

  resetViewport(): void {
    this.visibleRange = null;
    this.visibleData = [];
  }

  clearWarnings(): void {
    this.warnings = [];
    this.notify();
  }
}

export default AppPresenter;
