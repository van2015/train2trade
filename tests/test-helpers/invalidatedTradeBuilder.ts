import { InvalidatedTrade, Side } from '../../src/shared/types/backtest';

export class InvalidatedTradeBuilder {
  private config: InvalidatedTrade = {
    id: 'invalidated-1',
    side: 'long',
    reason: 'ambiguous',
    at: 1,
  };

  id(id: string): this {
    this.config.id = id;
    return this;
  }

  side(side: Side): this {
    this.config.side = side;
    return this;
  }

  reason(reason: string): this {
    this.config.reason = reason;
    return this;
  }

  at(at: number): this {
    this.config.at = at;
    return this;
  }

  build(): InvalidatedTrade {
    return { ...this.config };
  }
}
