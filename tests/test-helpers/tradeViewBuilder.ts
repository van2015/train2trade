import { TradeState, TradeView, Side } from '../../src/backtest/types/backtest';

export class TradeViewBuilder {
  private config: TradeView = {
    id: 'trade-1',
    side: 'long',
    state: 'open',
    size: 1,
    averageEntry: 100,
    realizedPnl: 0,
  };

  id(id: string): this {
    this.config.id = id;
    return this;
  }

  side(side: Side): this {
    this.config.side = side;
    return this;
  }

  state(state: TradeState): this {
    this.config.state = state;
    return this;
  }

  open(): this {
    return this.state('open');
  }

  pending(): this {
    return this.state('pending');
  }

  closed(): this {
    return this.state('closed');
  }

  size(size: number): this {
    this.config.size = size;
    return this;
  }

  averageEntry(averageEntry: number): this {
    this.config.averageEntry = averageEntry;
    return this;
  }

  stopLoss(stopLoss: number): this {
    this.config.stopLoss = stopLoss;
    return this;
  }

  takeProfit(takeProfit: number): this {
    this.config.takeProfit = takeProfit;
    return this;
  }

  realizedPnl(realizedPnl: number): this {
    this.config.realizedPnl = realizedPnl;
    return this;
  }

  rMultiple(rMultiple: number): this {
    this.config.rMultiple = rMultiple;
    return this;
  }

  build(): TradeView {
    return { ...this.config };
  }
}
