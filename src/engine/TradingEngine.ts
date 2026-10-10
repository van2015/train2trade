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
  open(order: OpenOrder): Result<Position, EngineError> {
    if (order.price <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    if (order.size <= 0) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    return {
      success: true,
      value: {
        side: order.side,
        entryPrice: order.price,
        size: order.size,
        state: 'open',
      },
    };
  }

  close(position: Position, price: number): Result<Position, EngineError> {
    if (position.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    const pct = ((price - position.entryPrice) / position.entryPrice) * 100;
    const pnl = position.side === 'short' ? -pct : pct;
    return {
      success: true,
      value: { ...position, state: 'closed', exitPrice: price, pnl },
    };
  }
}
