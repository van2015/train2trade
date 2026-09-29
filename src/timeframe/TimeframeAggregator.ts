import { PriceData } from '../types/asset';
import { Timeframe } from './Timeframe';
import { AggregatedBar } from '../types/backtest';

export interface AggregationResult {
  bars: AggregatedBar[];
  subBars: PriceData[];
  hasFinerData: boolean;
}

export class TimeframeAggregator {

  private floorToBoundary(time: number, tfMinutes: number): number {
    const span = tfMinutes * 60 * 1000;
    return Math.floor(time / span) * span;
  }

  private formatDate(time: number): string {
    return new Date(time).toISOString().replace('.000Z', 'Z');
  }

  aggregate(data: PriceData[], targetTF: Timeframe): AggregatedBar[] {
    if (data.length === 0) {
      return [];
    }

    const targetMinutes = Timeframe.getMinutes(targetTF);
    const buckets = this.createTimeBuckets(data, targetMinutes);
    const sortedStarts = this.sortBucketsChronologically(buckets);

    return this.buildAggregatedBars(buckets, sortedStarts, targetMinutes);
  }

  aggregateWithGaps(data: PriceData[], targetTF: Timeframe): AggregationResult {
    if (data.length === 0) {
      return { bars: [], subBars: [], hasFinerData: false };
    }

    const targetMinutes = Timeframe.getMinutes(targetTF);
    const gapEnds = new Set(Timeframe.detectGaps(data).map(gap => gap.endRow));
    const groups = this.createTimeBucketsWithGaps(data, targetMinutes, gapEnds);
    const bars = this.buildAggregatedBarsWithGaps(groups, targetMinutes);

    return {
      bars,
      subBars: data,
      hasFinerData: true,
    };
  }

  private createTimeBuckets(data: PriceData[], targetMinutes: number): Map<number, PriceData[]> {
    const bucketSpanMs = targetMinutes * 60 * 1000;
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

    return buckets;
  }

  private sortBucketsChronologically(buckets: Map<number, PriceData[]>): number[] {
    return [...buckets.keys()].sort((a, b) => a - b);
  }

  private buildAggregatedBars(
    buckets: Map<number, PriceData[]>,
    sortedStarts: number[],
    targetMinutes: number
  ): AggregatedBar[] {
    const bars: AggregatedBar[] = [];
    const targetSpan = targetMinutes * 60 * 1000;

    for (let i = 0; i < sortedStarts.length; i++) {
      const start = sortedStarts[i];
      const bucket = buckets.get(start)!;
      const previousEnd = i > 0 ? sortedStarts[i - 1] + targetSpan : start;
      const date = Math.max(start, previousEnd);

      bars.push(this.createBar(bucket, date));
    }

    return bars;
  }

  private createTimeBucketsWithGaps(
    data: PriceData[],
    targetMinutes: number,
    gapEnds: Set<number>
  ): { bucketKey: number; candles: PriceData[] }[] {
    const bucketSpanMs = targetMinutes * 60 * 1000;
    const groups: { bucketKey: number; candles: PriceData[] }[] = [];
    let currentBoundary = -Infinity;
    let currentGroup: { bucketKey: number; candles: PriceData[] } | null = null;

    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      const timestamp = new Date(sample.date).getTime();
      const boundary = Math.floor(timestamp / bucketSpanMs) * bucketSpanMs;
      const startsNewGroup = groups.length === 0 || boundary !== currentBoundary || gapEnds.has(i);

      if (startsNewGroup) {
        currentGroup = { bucketKey: boundary, candles: [] };
        groups.push(currentGroup);
        currentBoundary = boundary;
      }

      currentGroup!.candles.push(sample);
    }

    return groups;
  }

  private buildAggregatedBarsWithGaps(
    groups: { bucketKey: number; candles: PriceData[] }[],
    targetMinutes: number
  ): AggregatedBar[] {
    const bars: AggregatedBar[] = [];
    const targetSpan = targetMinutes * 60 * 1000;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const firstTimestamp = new Date(group.candles[0].date).getTime();
      const boundary = Math.floor(firstTimestamp / targetSpan) * targetSpan;
      const previousEnd = i > 0
        ? new Date(bars[i - 1].date).getTime() + targetSpan
        : boundary;
      const date = Math.max(boundary, previousEnd);

      bars.push(this.createBar(group.candles, date));
    }

    return bars;
  }

  private createBar(candles: PriceData[], date: number): AggregatedBar {
    const first = candles[0];
    const last = candles[candles.length - 1];

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const candle of candles) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
      volume += candle.volume;
    }

    return {
      date: this.formatDate(date),
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      subBars: candles,
    };
  }
}
