import type { Result } from '../shared/types/Result';

export type Side = 'long' | 'short';

export type EngineError =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'POSITION_NOT_OPEN';

export interface OpenOrder {
  side: Side;
  price: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface Position {
  side: Side;
  entryPrice: number;
  size: number;
  state: 'open' | 'closed';
  exitPrice?: number;
  pnl?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export class TradingEngine {
  private readonly positions: Position[] = [];

  get openPositions(): Position[] {
    return this.positions.filter((p) => p.state === 'open');
  }

  get totalPnl(): number {
    return this.positions
      .filter((p) => p.state === 'closed')
      .reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  }

  unrealizedPnl(price: number): number {
    return this.openPositions.reduce(
      (sum, p) => sum + this.calcPnl(p, price),
      0
    );
  }

  open(order: OpenOrder): Result<Position, EngineError> {
    const price = this.ensurePositive(order.price, 'INVALID_PRICE');
    if (!price.success) {
      return price;
    }
    const size = this.ensurePositive(order.size, 'INVALID_SIZE');
    if (!size.success) {
      return size;
    }
    const position: Position = {
      side: order.side,
      entryPrice: order.price,
      size: order.size,
      state: 'open',
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
    };
    this.positions.push(position);
    return { success: true, value: position };
  }

  close(position: Position, price: number): Result<Position, EngineError> {
    const exit = this.ensurePositive(price, 'INVALID_PRICE');
    if (!exit.success) {
      return exit;
    }
    if (position.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    const closed: Position = {
      ...position,
      state: 'closed',
      exitPrice: price,
      pnl: this.calcPnl(position, price),
    };
    const index = this.positions.indexOf(position);
    if (index >= 0) {
      this.positions[index] = closed;
    }
    return { success: true, value: closed };
  }

  checkStops(price: number): Position[] {
    const stopped: Position[] = [];
    for (const position of this.openPositions) {
      const stopLoss = position.stopLoss;
      if (stopLoss !== undefined && this.isStopHit(position, price)) {
        const result = this.close(position, stopLoss);
        if (result.success) {
          stopped.push(result.value);
        }
      }
    }
    return stopped;
  }

  private isStopHit(position: Position, price: number): boolean {
    if (position.stopLoss === undefined) {
      return false;
    }
    return position.side === 'long'
      ? price <= position.stopLoss
      : price >= position.stopLoss;
  }

  private ensurePositive(
    value: number,
    error: EngineError
  ): Result<void, EngineError> {
    return value <= 0
      ? { success: false, error }
      : { success: true, value: undefined };
  }

  private calcPnl(position: Position, exitPrice: number): number {
    const pct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    return position.side === 'short' ? -pct : pct;
  }
}
