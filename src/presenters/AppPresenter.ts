import { Asset, ChartType, PriceData } from '../types/asset';
import {
  getAssets,
  saveAsset,
  deleteAsset,
  parseCSV,
  parseJSON,
} from '../services/storageService';

export interface AppState {
  assets: Asset[];
  selectedAssetId: string | null;
  chartType: ChartType;
  error: string | null;
}

class AppPresenter {
  private static instance: AppPresenter;

  private assets: Asset[] = [];
  private selectedAssetId: string | null = null;
  private chartType: ChartType = 'line';
  private error: string | null = null;
  private listeners: Set<(state: AppState) => void> = new Set();

  private constructor() {}

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
    return {
      assets: this.assets,
      selectedAssetId: this.selectedAssetId,
      chartType: this.chartType,
      error: this.error,
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
      const content = await file.text();
      let data: PriceData[];

      if (file.name.endsWith('.csv')) {
        data = parseCSV(content);
      } else if (file.name.endsWith('.json')) {
        data = parseJSON(content);
      } else {
        throw new Error('Unsupported file format. Use CSV or JSON.');
      }

      const assetName = name || file.name.replace(/\.[^.]+$/, '');
      await saveAsset(assetName, data);
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
}

export default AppPresenter;
