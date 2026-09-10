import { Interval } from '../utils/Interval';

export interface PriceRetrievalStrategy {
  getRange(assetId: string, range: Interval): Promise<Interval>;
}

export class RangeStrategy implements PriceRetrievalStrategy {
  constructor(private readonly bufferRatio = 0.2) {}

  async getRange(_assetId: string, range: Interval): Promise<Interval> {
    const buffer = range.span * this.bufferRatio;
    return new Interval(range.from - buffer, range.to + buffer);
  }
}
