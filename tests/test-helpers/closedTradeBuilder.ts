import { ClosedTrade, Side } from '../../src/types/backtest';

export class ClosedTradeBuilder {
  private config: ClosedTrade = {
    id: 'trade-1',
    side: 'long',
    size: 1,
    averageEntry: 100,
    grossPnl: 0,
    fees: 0,
    netPnl: 0,
    openedAt: 0,
    closedAt: 1,
  };

  private grossPnlSet = false;

  id(id: string): this {
    this.config.id = id;
    return this;
  }

  side(side: Side): this {
    this.config.side = side;
    return this;
  }

  size(size: number): this {
    this.config.size = size;
    return this;
  }

  averageEntry(averageEntry: number): this {
    this.config.averageEntry = averageEntry;
    return this;
  }

  initialStopLoss(initialStopLoss: number): this {
    this.config.initialStopLoss = initialStopLoss;
    return this;
  }

  grossPnl(grossPnl: number): this {
    this.config.grossPnl = grossPnl;
    this.grossPnlSet = true;
    return this;
  }

  fees(fees: number): this {
    this.config.fees = fees;
    return this;
  }

  netPnl(netPnl: number): this {
    this.config.netPnl = netPnl;
    return this;
  }

  rMultiple(rMultiple: number): this {
    this.config.rMultiple = rMultiple;
    return this;
  }

  openedAt(openedAt: number): this {
    this.config.openedAt = openedAt;
    return this;
  }

  closedAt(closedAt: number): this {
    this.config.closedAt = closedAt;
    return this;
  }

  build(): ClosedTrade {
    const grossPnl = this.grossPnlSet
      ? this.config.grossPnl
      : this.config.netPnl + this.config.fees;
    return { ...this.config, grossPnl };
  }
}
