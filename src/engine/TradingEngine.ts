import type { Result } from '../shared/types/Result';

export type Side = 'long' | 'short';

export type EngineError = 'INVALID_PRICE';

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

  close(position: Position, price: number): Position {
    const pct = ((price - position.entryPrice) / position.entryPrice) * 100;
    const pnl = position.side === 'short' ? -pct : pct;
    return { ...position, state: 'closed', exitPrice: price, pnl };
  }
}
