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
}

export interface Position {
  side: Side;
  entryPrice: number;
  size: number;
  state: 'open' | 'closed';
  exitPrice?: number;
  pnl?: number;
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

  open(order: OpenOrder): Result<Position, EngineError> {
    if (order.price <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    if (order.size <= 0) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    const position: Position = {
      side: order.side,
      entryPrice: order.price,
      size: order.size,
      state: 'open',
    };
    this.positions.push(position);
    return { success: true, value: position };
  }

  close(position: Position, price: number): Result<Position, EngineError> {
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

  private calcPnl(position: Position, exitPrice: number): number {
    const pct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    return position.side === 'short' ? -pct : pct;
  }
}
