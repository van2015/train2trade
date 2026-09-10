import { AssetSummary, PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';
import { AssetChartRepository } from './AssetChartRepository';
import { IndexedDbAssetChartRepository } from './IndexedDbAssetChartRepository';
import { Interval } from '../utils/Interval';

const DEFAULT_INITIAL_CANDLES = 500;
const MAX_SAMPLES = 10000;

class AssetService {
  private static instance: AssetService;

  private rangeCache = new Map<string, PriceData[]>();

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
    const from = to - DEFAULT_INITIAL_CANDLES * intervalMs;
    return new Interval(from, to);
  }

  async fetchSamples(assetId: string, from: number, to: number): Promise<PriceData[]> {
    return this.repo.getSamplesRange(assetId, from, to);
  }

  addRangeData(assetId: string, samples: PriceData[]): Interval {
    const existing = this.rangeCache.get(assetId) ?? [];
    const oldMin = existing.length > 0 ? this.timeOf(existing[0]) : Infinity;
    const oldMax = existing.length > 0 ? this.timeOf(existing[existing.length - 1]) : -Infinity;

    let newMin = oldMin;
    let newMax = oldMax;
    for (const sample of samples) {
      const time = this.timeOf(sample);
      if (time < newMin) newMin = time;
      if (time > newMax) newMax = time;
    }

    const merged = this.mergeSamples(existing, samples);
    let result = merged;

    if (merged.length > MAX_SAMPLES) {
      const excess = merged.length - MAX_SAMPLES;
      if (newMin < oldMin) {
        result = merged.slice(0, merged.length - excess);
      } else if (newMax > oldMax) {
        result = merged.slice(excess);
      } else {
        result = merged.slice(0, merged.length - excess);
      }
    }

    this.rangeCache.set(assetId, result);
    return new Interval(this.timeOf(result[0]), this.timeOf(result[result.length - 1]));
  }

  private mergeSamples(a: PriceData[], b: PriceData[]): PriceData[] {
    const byTime = new Map<number, PriceData>();
    for (const sample of a) byTime.set(this.timeOf(sample), sample);
    for (const sample of b) byTime.set(this.timeOf(sample), sample);
    return [...byTime.entries()].sort((x, y) => x[0] - y[0]).map(([, sample]) => sample);
  }

  private timeOf(sample: PriceData): number {
    return new Date(sample.date).getTime();
  }

  priceSample(
    assetId: string,
    originalTimeframe: TimeframeType,
    targetTimeframe: TimeframeType
  ): PriceData[] | null {
    const data = this.rangeCache.get(assetId);
    if (!data) return null;

    return this.aggregate(data, targetTimeframe, originalTimeframe);
  }

  private getTimeframeFactor(original: TimeframeType, target: TimeframeType): number {
    if (original === target) return 1;
    return Timeframe.getMinutes(target) / Timeframe.getMinutes(original);
  }

  aggregate(
    data: PriceData[],
    targetTF: TimeframeType,
    originalTF: TimeframeType
  ): PriceData[] {
    if (targetTF === originalTF) {
      return data;
    }

    const factor = this.getTimeframeFactor(originalTF, targetTF);

    if (factor <= 1) {
      return data;
    }

    const bucketSpanMs = Timeframe.getMinutes(targetTF) * 60 * 1000;
    const buckets = new Map<number, PriceData[]>();

    for (const sample of data) {
      const timestamp = new Date(sample.date).getTime();
      const bucketStart = Math.floor(timestamp / bucketSpanMs) * bucketSpanMs;
      let bucket = buckets.get(bucketStart);
      if (!bucket) {
        bucket = [];
        buckets.set(bucketStart, bucket);
      }
      bucket.push(sample);
    }

    const result: PriceData[] = [];
    const starts = [...buckets.keys()].sort((a, b) => a - b);

    for (const start of starts) {
      const bucket = buckets.get(start)!;
      let high = -Infinity;
      let low = Infinity;
      let volume = 0;

      for (const candle of bucket) {
        if (candle.high > high) high = candle.high;
        if (candle.low < low) low = candle.low;
        volume += candle.volume;
      }

      result.push({
        date: new Date(start).toISOString().replace('.000Z', 'Z'),
        open: bucket[0].open,
        high,
        low,
        close: bucket[bucket.length - 1].close,
        volume,
      });
    }

    return result;
  }

  filterByRange(data: PriceData[], from: string, to: string): PriceData[] {
    if (data.length === 0) return [];

    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();

    const startIndex = this.lowerBoundMs(data, fromMs);
    const endIndex = this.upperBoundMs(data, toMs);

    if (startIndex >= endIndex) return [];

    return data.slice(startIndex, endIndex);
  }

  filterByRangeWithBuffer(data: PriceData[], from: string, to: string): PriceData[] {
    if (data.length === 0) return [];

    const rangeStart = new Date(from).getTime();
    const rangeEnd = new Date(to).getTime();
    const rangeMs = rangeEnd - rangeStart;
    const bufferMs = rangeMs * 0.2;

    const bufferedFrom = new Date(rangeStart - bufferMs).toISOString();
    const bufferedTo = new Date(rangeEnd + bufferMs).toISOString();

    const clampedFrom = bufferedFrom < data[0].date ? data[0].date : bufferedFrom;
    const clampedTo = bufferedTo > data[data.length - 1].date ? data[data.length - 1].date : bufferedTo;

    return this.filterByRange(data, clampedFrom, clampedTo);
  }

  clearCache(assetId?: string): void {
    if (assetId) {
      this.rangeCache.delete(assetId);
    } else {
      this.rangeCache.clear();
    }
  }

  private lowerBoundMs(data: PriceData[], targetMs: number): number {
    let low = 0;
    let high = data.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (new Date(data[mid].date).getTime() < targetMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private upperBoundMs(data: PriceData[], targetMs: number): number {
    let low = 0;
    let high = data.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (new Date(data[mid].date).getTime() <= targetMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}

export { AssetService };
