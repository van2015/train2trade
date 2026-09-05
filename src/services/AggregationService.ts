import { PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';

class AggregationCache {
  private static instance: AggregationCache;
  private cache = new Map<string, Map<TimeframeType, PriceData[]>>();

  private constructor() {}

  static getInstance(): AggregationCache {
    if (!AggregationCache.instance) {
      AggregationCache.instance = new AggregationCache();
    }
    return AggregationCache.instance;
  }

  get(assetId: string, tf: TimeframeType): PriceData[] | undefined {
    const assetCache = this.cache.get(assetId);
    if (!assetCache) return undefined;
    return assetCache.get(tf);
  }

  set(assetId: string, tf: TimeframeType, data: PriceData[]): void {
    let assetCache = this.cache.get(assetId);
    if (!assetCache) {
      assetCache = new Map();
      this.cache.set(assetId, assetCache);
    }
    assetCache.set(tf, data);
  }

  clear(assetId?: string): void {
    if (assetId) {
      this.cache.delete(assetId);
    } else {
      this.cache.clear();
    }
  }
}

class AggregationService {
  private static instance: AggregationService;
  private cache: AggregationCache;

  private constructor() {
    this.cache = AggregationCache.getInstance();
  }

  static getInstance(): AggregationService {
    if (!AggregationService.instance) {
      AggregationService.instance = new AggregationService();
    }
    return AggregationService.instance;
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

  getTimeframeData(
    assetId: string,
    originalData: PriceData[],
    originalTimeframe: TimeframeType,
    targetTimeframe: TimeframeType
  ): PriceData[] {
    if (targetTimeframe === originalTimeframe) {
      return originalData;
    }

    const cached = this.cache.get(assetId, targetTimeframe);
    if (cached) {
      return cached;
    }

    const aggregated = this.aggregate(originalData, targetTimeframe, originalTimeframe);
    this.cache.set(assetId, targetTimeframe, aggregated);

    return aggregated;
  }

  clearCache(assetId?: string): void {
    this.cache.clear(assetId);
  }
}

export { AggregationService, AggregationCache };
