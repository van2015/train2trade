import { Interval } from '../utils/Interval';

export interface PriceRetrievalStrategy {
  getRange(assetId: string, range: Interval): Promise<Interval>;
}

export class RangeStrategy implements PriceRetrievalStrategy {
  constructor(private readonly bufferRatio = 0.2) {}

  async getRange(_assetId: string, range: Interval): Promise<Interval> {
    return range.expand(this.bufferRatio);
  }
}
