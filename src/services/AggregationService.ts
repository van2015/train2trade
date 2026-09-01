import { PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';

const cache = new Map<string, Map<TimeframeType, PriceData[]>>();

function getCacheKey(assetId: string): string {
  return assetId;
}

export function getTimeframeFactor(original: TimeframeType, target: TimeframeType): number {
  if (original === target) return 1;
  return Timeframe.getMinutes(target) / Timeframe.getMinutes(original);
}

export function aggregate(
  data: PriceData[],
  targetTF: TimeframeType,
  originalTF: TimeframeType
): PriceData[] {
  if (targetTF === originalTF) {
    return data;
  }

  const factor = getTimeframeFactor(originalTF, targetTF);

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

export function getCachedData(
  assetId: string,
  timeframe: TimeframeType
): PriceData[] | undefined {
  const assetCache = cache.get(getCacheKey(assetId));
  if (!assetCache) return undefined;
  return assetCache.get(timeframe);
}

export function setCachedData(
  assetId: string,
  timeframe: TimeframeType,
  data: PriceData[]
): void {
  let assetCache = cache.get(getCacheKey(assetId));
  if (!assetCache) {
    assetCache = new Map();
    cache.set(getCacheKey(assetId), assetCache);
  }
  assetCache.set(timeframe, data);
}

export function clearCache(assetId?: string): void {
  if (assetId) {
    cache.delete(getCacheKey(assetId));
  } else {
    cache.clear();
  }
}

export function getAggregatedData(
  assetId: string,
  originalData: PriceData[],
  originalTimeframe: TimeframeType,
  targetTimeframe: TimeframeType
): PriceData[] {
  if (targetTimeframe === originalTimeframe) {
    return originalData;
  }

  const cached = getCachedData(assetId, targetTimeframe);
  if (cached) {
    return cached;
  }

  const aggregated = aggregate(originalData, targetTimeframe, originalTimeframe);
  setCachedData(assetId, targetTimeframe, aggregated);

  return aggregated;
}
