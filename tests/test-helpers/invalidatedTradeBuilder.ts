import type { InvalidatedTrade, Side } from '../../src/backtest/types/backtest';
import type { TradeError } from '../../src/backtest/types/TradeError';

export class InvalidatedTradeBuilder {
  private config: InvalidatedTrade = {
    id: 'invalidated-1',
    side: 'long',
    reason: { type: 'AMBIGUOUS_CANDLE', id: 'invalidated-1' },
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

  reason(reason: TradeError): this {
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
