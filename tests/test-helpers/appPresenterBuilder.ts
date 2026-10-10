import AppPresenter from '../../src/chart/presenters/AppPresenter';
import type {
  AssetSummary,
  IndicatorInstance,
  Timeframe,
} from '../../src/shared/types/asset';
import type { Interval } from '../../src/shared/utils/Interval';

export class AppPresenterBuilder {
  private assets: AssetSummary[] | null = null;
  private loadedRange: Interval | null = null;
  private lastSampleTime: number | null = null;
  private selectedTimeframe: Timeframe | null = null;
  private activeIndicators: IndicatorInstance[] | null = null;
  private selectedAssetId: string | null = null;
  private currentRange: Interval | null = null;

  withAssets(assets: AssetSummary[]): this {
    this.assets = assets;
    return this;
  }

  withRange(loadedRange: Interval, lastSampleTime?: number): this {
    this.loadedRange = loadedRange;
    if (lastSampleTime !== undefined) {
      this.lastSampleTime = lastSampleTime;
    }
    return this;
  }

  withLastSampleTime(time: number): this {
    this.lastSampleTime = time;
    return this;
  }

  withTimeframe(tf: Timeframe): this {
    this.selectedTimeframe = tf;
    return this;
  }

  withIndicators(indicators: IndicatorInstance[]): this {
    this.activeIndicators = indicators;
    return this;
  }

  withSelection(assetId: string, range: Interval): this {
    this.selectedAssetId = assetId;
    this.currentRange = range;
    return this;
  }

  static destroy(): void {
    Object.assign(AppPresenter, { instance: null });
  }

  build(): AppPresenter {
    AppPresenterBuilder.destroy();
    const presenter = AppPresenter.getInstance();
    if (this.assets !== null) Object.assign(presenter, { assets: this.assets });
    if (this.loadedRange !== null)
      Object.assign(presenter, { loadedRange: this.loadedRange });
    if (this.lastSampleTime !== null)
      Object.assign(presenter, { lastSampleTime: this.lastSampleTime });
    if (this.selectedTimeframe !== null)
      Object.assign(presenter, { selectedTimeframe: this.selectedTimeframe });
    if (this.activeIndicators !== null)
      Object.assign(presenter, { activeIndicators: this.activeIndicators });
    if (this.selectedAssetId !== null)
      Object.assign(presenter, { selectedAssetId: this.selectedAssetId });
    if (this.currentRange !== null)
      Object.assign(presenter, { currentRange: this.currentRange });
    return presenter;
  }
}
