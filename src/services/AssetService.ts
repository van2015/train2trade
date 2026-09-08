import { AssetSummary, PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';
import { AssetChartRepository } from './AssetChartRepository';
import { IndexedDbAssetChartRepository } from './IndexedDbAssetChartRepository';

class AssetService {
  private static instance: AssetService;

  private rawCache = new Map<string, PriceData[]>();
  private aggCache = new Map<string, Map<TimeframeType, PriceData[]>>();

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

  async ensureData(assetId: string): Promise<void> {
    if (this.rawCache.has(assetId)) return;
    const data = await this.repo.getAssetData(assetId);
    this.rawCache.set(assetId, data);
  }

  getTimeframeData(
    assetId: string,
    originalTimeframe: TimeframeType,
    targetTimeframe: TimeframeType
  ): PriceData[] | null {
    const data = this.rawCache.get(assetId);
    if (!data) return null;

    if (targetTimeframe === originalTimeframe) {
      return data;
    }

    const cached = this.aggCache.get(assetId)?.get(targetTimeframe);
    if (cached) {
      return cached;
    }

    const aggregated = this.aggregate(data, targetTimeframe, originalTimeframe);

    let assetCache = this.aggCache.get(assetId);
    if (!assetCache) {
      assetCache = new Map();
      this.aggCache.set(assetId, assetCache);
    }
    assetCache.set(targetTimeframe, aggregated);

    return aggregated;
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

    const result: PriceData[] = [];

    for (let i = 0; i < data.length; i += factor) {
      if (i + factor > data.length) {
        break;
      }

      const chunk = data.slice(i, i + factor);

      let high = -Infinity;
      let low = Infinity;
      let volume = 0;

      for (const candle of chunk) {
        if (candle.high > high) high = candle.high;
        if (candle.low < low) low = candle.low;
        volume += candle.volume;
      }

      result.push({
        date: chunk[0].date,
        open: chunk[0].open,
        high,
        low,
        close: chunk[chunk.length - 1].close,
        volume,
      });
    }

    return result;
  }

  filterByRange(data: PriceData[], from: string, to: string): PriceData[] {
    if (data.length === 0) return [];

    const startIndex = this.lowerBound(data, from);
    const endIndex = this.upperBound(data, to);

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
      this.rawCache.delete(assetId);
      this.aggCache.delete(assetId);
    } else {
      this.rawCache.clear();
      this.aggCache.clear();
    }
  }

  private lowerBound(data: PriceData[], target: string): number {
    let low = 0;
    let high = data.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (data[mid].date < target) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private upperBound(data: PriceData[], target: string): number {
    let low = 0;
    let high = data.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (data[mid].date <= target) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}

export { AssetService };
