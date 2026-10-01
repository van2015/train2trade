import { Interval } from '../shared/utils/Interval';

export interface PriceRetrievalStrategy {
  getRange(assetId: string, range: Interval, warmupMs?: number): Promise<Interval>;
}

export class RangeStrategy implements PriceRetrievalStrategy {
  constructor(private readonly bufferRatio = 0.2) {}

  async getRange(_assetId: string, range: Interval, warmupMs = 0): Promise<Interval> {
    const buffered = range.expand(this.bufferRatio);
    if (warmupMs <= 0) return buffered;
    return buffered.union(new Interval(range.from - warmupMs, range.from));
  }
}
