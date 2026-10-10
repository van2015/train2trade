import type { Result } from '../shared/types/Result';

export type Side = 'long' | 'short';

export type EngineError =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INVALID_STOP_LOSS'
  | 'INVALID_TAKE_PROFIT'
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
    const valid = this.validateOrder(order);
    if (!valid.success) {
      return valid;
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

  private validateOrder(order: OpenOrder): Result<void, EngineError> {
    const price = this.ensurePositive(order.price, 'INVALID_PRICE');
    if (!price.success) {
      return price;
    }
    const size = this.ensurePositive(order.size, 'INVALID_SIZE');
    if (!size.success) {
      return size;
    }
    if (order.stopLoss !== undefined) {
      const invalidStop =
        order.side === 'long'
          ? order.stopLoss >= order.price
          : order.stopLoss <= order.price;
      if (invalidStop) {
        return { success: false, error: 'INVALID_STOP_LOSS' };
      }
    }
    if (
      order.side === 'long' &&
      order.takeProfit !== undefined &&
      order.takeProfit <= order.price
    ) {
      return { success: false, error: 'INVALID_TAKE_PROFIT' };
    }
    return { success: true, value: undefined };
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

  checkExits(price: number): Position[] {
    const exited: Position[] = [];
    for (const position of this.openPositions) {
      const exitPrice = this.exitPriceAt(position, price);
      if (exitPrice !== null) {
        const result = this.close(position, exitPrice);
        if (result.success) {
          exited.push(result.value);
        }
      }
    }
    return exited;
  }

  private exitPriceAt(position: Position, price: number): number | null {
    const { stopLoss, takeProfit } = position;
    if (stopLoss !== undefined && this.isStopHit(position, price)) {
      return stopLoss;
    }
    if (takeProfit !== undefined && this.isTakeProfitHit(position, price)) {
      return takeProfit;
    }
    return null;
  }

  private isStopHit(position: Position, price: number): boolean {
    if (position.stopLoss === undefined) {
      return false;
    }
    return position.side === 'long'
      ? price <= position.stopLoss
      : price >= position.stopLoss;
  }

  private isTakeProfitHit(position: Position, price: number): boolean {
    if (position.takeProfit === undefined) {
      return false;
    }
    return position.side === 'long'
      ? price >= position.takeProfit
      : price <= position.takeProfit;
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
