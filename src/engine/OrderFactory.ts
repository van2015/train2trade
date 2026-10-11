import { LongOrder } from './LongOrder';
import type { Order } from './Order';
import { ShortOrder } from './ShortOrder';
import type { ExitLevel } from './types';

const constructors = {
  long: LongOrder,
  short: ShortOrder,
} as const;

export { constructors };

export type OrderSide = keyof typeof constructors;

export function createOpenOrder(
  side: OrderSide,
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
  return new constructors[side]('open', price, size, opts);
}

export function createPendingOrder(
  side: OrderSide,
  limitPrice: number,
  size: number,
  opts?: {
    stopLoss?: number;
    takeProfit?: number;
    exitLevels?: ExitLevel[];
  }
): Order {
  return new constructors[side]('pending', limitPrice, size, opts);
}
