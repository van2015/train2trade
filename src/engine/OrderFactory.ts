import { LongOrder } from './LongOrder';
import type { Order } from './Order';
import { ShortOrder } from './ShortOrder';
import type { ExitLevel } from './types';

export function createOpenOrder(
  side: 'long' | 'short',
  price: number,
  size: number,
  opts?: {
    stopLoss?: number;
    takeProfit?: number;
    exitLevels?: ExitLevel[];
    entryFee?: number;
    feeBasis?: number;
  }
): Order {
  return side === 'long'
    ? new LongOrder('open', price, size, opts)
    : new ShortOrder('open', price, size, opts);
}

export function createPendingOrder(
  side: 'long' | 'short',
  limitPrice: number,
  size: number,
  opts?: {
    stopLoss?: number;
    takeProfit?: number;
    exitLevels?: ExitLevel[];
  }
): Order {
  return side === 'long'
    ? new LongOrder('pending', limitPrice, size, opts)
    : new ShortOrder('pending', limitPrice, size, opts);
}
