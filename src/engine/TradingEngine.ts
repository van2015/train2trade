export type Side = 'long' | 'short';

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
  open(order: OpenOrder): Position {
    return {
      side: order.side,
      entryPrice: order.price,
      size: order.size,
      state: 'open',
    };
  }

  close(position: Position, price: number): Position {
    const pnl = (price - position.entryPrice) * position.size;
    return { ...position, state: 'closed', exitPrice: price, pnl };
  }
}
