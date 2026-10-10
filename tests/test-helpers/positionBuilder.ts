import type { Position } from '../../src/engine/TradingEngine';

export class PositionBuilder {
  private config: Position = {
    side: 'long',
    entryPrice: 100,
    size: 1,
    state: 'open',
  };

  side(side: Position['side']): this {
    this.config.side = side;
    return this;
  }

  long(): this {
    return this.side('long');
  }

  short(): this {
    return this.side('short');
  }

  entryPrice(price: number): this {
    this.config.entryPrice = price;
    return this;
  }

  size(size: number): this {
    this.config.size = size;
    return this;
  }

  state(state: Position['state']): this {
    this.config.state = state;
    return this;
  }

  exitPrice(price: number): this {
    this.config.exitPrice = price;
    return this;
  }

  stopLoss(price: number): this {
    this.config.stopLoss = price;
    return this;
  }

  build(): Position {
    return { ...this.config };
  }
}
