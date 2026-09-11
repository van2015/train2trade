import {
  AssetSummary,
  ChartType,
  IndicatorId,
  IndicatorInstance,
  PriceData,
} from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';
import { validateAndParse } from '../services/ValidationService';
import { AssetService } from '../services/AssetService';
import { PriceRetrievalStrategy, RangeStrategy } from '../services/PriceRetrievalStrategy';
import {
  createIndicatorInstance,
  getDefinition,
  maxLookback,
  normalizeParams,
} from '../services/IndicatorService';
import { Interval } from '../utils/Interval';

const TIMEFRAME_STORAGE_KEY = 'selectedTimeframe';
const INDICATORS_STORAGE_KEY = 'activeIndicators';

export interface AppState {
  selectedAssetId: string | null;
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
  private initPromise: Promise<void>;
  private assets: AssetSummary[] = [];
  private selectedAssetId: string | null = null;
  private currentRange: Interval | null = null;
  private loadedRange: Interval | null = null;
  private chartType: ChartType = 'line';
  private selectedTimeframe: TimeframeType = '1D';
  private activeIndicators: IndicatorInstance[] = [];
  private error: string | null = null;
  private warnings: string[] = [];
  private listeners: Set<(state: AppState) => void> = new Set();

  private constructor() {
    this.initPromise = this.assetService.init();
    this.loadTimeframeFromStorage();
    this.loadIndicatorsFromStorage();
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

  private loadIndicatorsFromStorage(): void {
    try {
      const stored = localStorage.getItem(INDICATORS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      this.activeIndicators = parsed
        .map(raw => this.sanitizeIndicator(raw))
        .filter((indicator): indicator is IndicatorInstance => indicator !== null);
    } catch {
      this.activeIndicators = [];
    }
  }

  private sanitizeIndicator(raw: unknown): IndicatorInstance | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<IndicatorInstance>;
    if (typeof candidate.key !== 'string' || candidate.key.length === 0) return null;
    if (typeof candidate.indicatorId !== 'string') return null;
    const definition = getDefinition(candidate.indicatorId as IndicatorId);
    if (!definition) return null;
    const params = normalizeParams(
      definition,
      (candidate.params ?? {}) as Record<string, number>
    );
    return {
      key: candidate.key,
      indicatorId: definition.id,
      params,
      color: typeof candidate.color === 'string' ? candidate.color : undefined,
    };
  }

  private saveIndicatorsToStorage(): void {
    try {
      localStorage.setItem(INDICATORS_STORAGE_KEY, JSON.stringify(this.activeIndicators));
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
      activeIndicators: this.activeIndicators,
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
    this.notify();
    const asset = this.assets.find(a => a.id === id);
    if (!asset) return;
    this.assetService.getInitialRange(id, asset.originalTimeframe).then(interval => {
      if (interval) this.requestRange(id, interval);
    });
  }

  async requestRange(assetId: string, interval: Interval): Promise<void> {
    try {
      this.currentRange = interval;
      const warmupMs = maxLookback(this.activeIndicators, this.selectedTimeframe);
      const resolved = await this.strategy.getRange(assetId, interval, warmupMs);
      const samples = await this.assetService.fetchSamples(assetId, resolved.from, resolved.to);
      this.loadedRange = this.assetService.setWindow(assetId, samples);
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
    if (
      this.selectedAssetId &&
      this.currentRange &&
      !this.hasCompleteData(this.currentRange)
    ) {
      void this.requestRange(this.selectedAssetId, this.currentRange);
    }
  }

  getActiveIndicators(): IndicatorInstance[] {
    return this.activeIndicators;
  }

  addIndicator(id: IndicatorId): Promise<void> {
    const instance = createIndicatorInstance(id);
    if (!instance) return Promise.resolve();
    this.activeIndicators = [...this.activeIndicators, instance];
    this.saveIndicatorsToStorage();
    this.notify();
    return this.refreshRange();
  }

  removeIndicator(key: string): Promise<void> {
    const next = this.activeIndicators.filter(indicator => indicator.key !== key);
    if (next.length === this.activeIndicators.length) return Promise.resolve();
    this.activeIndicators = next;
    this.saveIndicatorsToStorage();
    this.notify();
    return this.refreshRange();
  }

  updateIndicator(key: string, params: Record<string, number>): Promise<void> {
    let changed = false;
    this.activeIndicators = this.activeIndicators.map(indicator => {
      if (indicator.key !== key) return indicator;
      const definition = getDefinition(indicator.indicatorId);
      if (!definition) return indicator;
      changed = true;
      return {
        ...indicator,
        params: normalizeParams(definition, { ...indicator.params, ...params }),
      };
    });
    if (!changed) return Promise.resolve();
    this.saveIndicatorsToStorage();
    this.notify();
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
    if (!this.loadedRange) return false;
    const warmupMs = maxLookback(this.activeIndicators, this.selectedTimeframe);
    const required =
      warmupMs > 0 ? new Interval(interval.from - warmupMs, interval.to) : interval;
    return this.loadedRange.contains(required);
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
