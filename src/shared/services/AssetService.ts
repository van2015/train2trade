import { AssetSummary, PriceData } from '../types/asset';
import { Timeframe } from '../../backtest/timeframe/Timeframe';
import { TimeframeAggregator } from '../../backtest/timeframe/TimeframeAggregator';
import { AssetChartRepository } from './repositories/AssetChartRepository';
import { IndexedDbAssetChartRepository } from './repositories/IndexedDbAssetChartRepository';
import { Interval } from '../../backtest/utils/Interval';

const DEFAULT_INITIAL_CANDLES = 500;

interface RangeWindow {
  range: Interval | null;
  samples: PriceData[];
}

class AssetService {
  private static instance: AssetService;
  private aggregator = new TimeframeAggregator();

  private windows = new Map<string, RangeWindow>();

  constructor(private readonly repo: AssetChartRepository) {}

  static getInstance(): AssetService {
    if (!AssetService.instance) {
      AssetService.instance = new AssetService(IndexedDbAssetChartRepository.getInstance());
    }
    return AssetService.instance;
  }

  async init(): Promise<void> {
    await this.repo.init();
  }

  async save(
    name: string,
    data: PriceData[],
    originalTimeframe: Timeframe
  ): Promise<AssetSummary> {
    return this.repo.saveAsset(name, data, originalTimeframe);
  }

  async getSummaries(): Promise<AssetSummary[]> {
    return this.repo.getAssetSummaries();
  }

  async delete(id: string): Promise<void> {
    await this.repo.deleteAsset(id);
    this.clearCache(id);
  }

  async getInitialRange(assetId: string, originalTimeframe: Timeframe): Promise<Interval | null> {
    const last = await this.repo.getLastSample(assetId);
    if (!last) return null;
    const intervalMs = Timeframe.getMinutes(originalTimeframe) * 60 * 1000;
    const to = new Date(last.date).getTime();
    return Interval.endingAt(to, DEFAULT_INITIAL_CANDLES * intervalMs);
  }

  async fetchSamples(assetId: string, from: number, to: number): Promise<PriceData[]> {
    return this.repo.getSamplesRange(assetId, from, to);
  }

  addRangeData(assetId: string, samples: PriceData[]): Interval | null {
    const existing = this.windows.get(assetId)?.samples ?? [];
    const merged = this.mergeSamples(existing, samples);

    const range = this.intervalOf(merged);
    this.windows.set(assetId, { range, samples: merged });
    return range;
  }

  private mergeSamples(a: PriceData[], b: PriceData[]): PriceData[] {
    const byTime = new Map<number, PriceData>();
    for (const sample of a) byTime.set(this.timeOf(sample), sample);
    for (const sample of b) byTime.set(this.timeOf(sample), sample);
    return [...byTime.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([, sample]) => sample);
  }

  private intervalOf(samples: PriceData[]): Interval | null {
    if (samples.length === 0) return null;
    return new Interval(this.timeOf(samples[0]), this.timeOf(samples[samples.length - 1]));
  }

  private timeOf(sample: PriceData): number {
    return new Date(sample.date).getTime();
  }

  priceSample(
    assetId: string,
    originalTimeframe: Timeframe,
    targetTimeframe: Timeframe
  ): PriceData[] | null {
    const window = this.windows.get(assetId);
    if (!window) return null;

    return this.aggregate(window.samples, targetTimeframe, originalTimeframe);
  }

  aggregate(
    data: PriceData[],
    targetTF: Timeframe,
    originalTF: Timeframe
  ): PriceData[] {
    if (targetTF === originalTF) {
      return data;
    }

    const factor = this.getTimeframeFactor(originalTF, targetTF);

    if (factor <= 1) {
      return data;
    }

    const aggregatedBars = this.aggregator.aggregate(data, targetTF);
    return aggregatedBars.map(bar => ({
      date: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  }

  private getTimeframeFactor(original: Timeframe, target: Timeframe): number {
    if (original === target) return 1;
    return Timeframe.getMinutes(target) / Timeframe.getMinutes(original);
  }

  clearCache(assetId?: string): void {
    if (assetId) {
      this.windows.delete(assetId);
    } else {
      this.windows.clear();
    }
  }
}

export { AssetService };
