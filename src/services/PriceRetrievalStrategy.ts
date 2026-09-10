export interface PriceRange {
  from: number;
  to: number;
}

export interface PriceRetrievalStrategy {
  getRange(assetId: string, range: PriceRange): Promise<PriceRange>;
}

export class RangeStrategy implements PriceRetrievalStrategy {
  constructor(private readonly bufferRatio = 0.2) {}

  async getRange(_assetId: string, range: PriceRange): Promise<PriceRange> {
    const { from, to } = range;
    const buffer = (to - from) * this.bufferRatio;
    return { from: from - buffer, to: to + buffer };
  }
}
