export type { Result } from '../shared/types/Result';
export { LongOrder } from './LongOrder';

export { Order } from './Order';
export { ShortOrder } from './ShortOrder';
export type {
  EngineError,
  ExitLevel,
  ExitLevelKind,
  OrderState,
} from './types';

import type { Order } from './Order';
import { createOpenOrder, createPendingOrder } from './OrderFactory';
import type { EngineError, ExitLevel, Result } from './types';

export interface EngineOptions {
  makerFeePercent?: number;
  takerFeePercent?: number;
}

export class TradingEngine {
  private readonly orders: Order[] = [];
  private readonly makerFeePercent: number;
  private readonly takerFeePercent: number;

  constructor(options: EngineOptions = {}) {
    this.makerFeePercent = options.makerFeePercent ?? 0;
    this.takerFeePercent = options.takerFeePercent ?? 0;
  }

  get pendingOrders(): Order[] {
    return this.orders.filter((o) => o.state === 'pending');
  }

  get openPositions(): Order[] {
    return this.orders.filter((o) => o.state === 'open');
  }

  get closedPositions(): Order[] {
    return this.orders.filter((o) => o.state === 'closed');
  }

  get totalPnl(): number {
    return this.closedPositions.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
  }

  unrealizedPnl(price: number): number {
    return this.openPositions.reduce((sum, o) => sum + o.pnlAt(price), 0);
  }

  equity(price: number): number {
    return this.totalPnl + this.unrealizedPnl(price);
  }

  open(input: {
    side: 'long' | 'short';
    price: number;
    size: number;
    stopLoss?: number;
    takeProfit?: number;
    exitLevels?: ExitLevel[];
  }): Result<Order, EngineError> {
    const order = createOpenOrder(input.side, input.price, input.size, {
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      exitLevels: input.exitLevels,
      entryFee: this.takerFeePercent,
      feeBasis: input.size,
    });
    const valid = order.validateOpen();
    if (!valid.success) {
      return valid;
    }
    this.orders.push(order);
    return { success: true, value: order };
  }

  placeLimitOrder(input: {
    side: 'long' | 'short';
    limitPrice: number;
    size: number;
    stopLoss?: number;
    takeProfit?: number;
    exitLevels?: ExitLevel[];
  }): Result<Order, EngineError> {
    const pending = createPendingOrder(
      input.side,
      input.limitPrice,
      input.size,
      {
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
      }
    );
    const valid = pending.validateOpen();
    if (!valid.success) {
      return valid;
    }
    this.orders.push(pending);
    return { success: true, value: pending };
  }

  cancelLimitOrder(order: Order): boolean {
    const index = this.orders.indexOf(order);
    if (index < 0 || order.state !== 'pending') {
      return false;
    }
    this.orders.splice(index, 1);
    return true;
  }

  removeExitLevel(order: Order, index: number): Result<Order, EngineError> {
    if (order.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    const result = order.removeExitLevel(index);
    if (!result.success) {
      return result;
    }
    const orderIndex = this.orders.indexOf(order);
    if (orderIndex >= 0) {
      this.orders[orderIndex] = result.value;
    }
    return result;
  }

  moveExitLevel(
    order: Order,
    index: number,
    newPrice: number
  ): Result<Order, EngineError> {
    if (order.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    const result = order.moveExitLevel(index, newPrice);
    if (!result.success) {
      return result;
    }
    const orderIndex = this.orders.indexOf(order);
    if (orderIndex >= 0) {
      this.orders[orderIndex] = result.value;
    }
    return result;
  }

  checkEntries(price: number): Order[] {
    const toFill = this.pendingOrders.filter((o) =>
      o.side() === 'long' ? price <= o.price : price >= o.price
    );
    const filled: Order[] = [];
    for (const order of toFill) {
      const index = this.orders.indexOf(order);
      if (index < 0) continue;
      const opened = order.fill(order.price, this.makerFeePercent);
      this.orders[index] = opened;
      filled.push(opened);
    }
    return filled;
  }

  close(order: Order, price: number): Result<Order, EngineError> {
    return this.closePartial(order, price);
  }

  closePartial(
    order: Order,
    price: number,
    sizePercent: number = 100,
    exitFee: number = this.takerFeePercent,
    excludeFromRemainder?: ExitLevel
  ): Result<Order, EngineError> {
    const valid = order.validateClose(price, sizePercent);
    if (!valid.success) {
      return valid;
    }
    const { closed, remainder } = order.close(
      price,
      sizePercent,
      exitFee,
      order.feeBasis ?? order.size,
      excludeFromRemainder
    );
    const index = this.orders.indexOf(order);
    if (index >= 0) {
      this.orders[index] = remainder ?? closed;
      if (remainder) {
        this.orders.push(closed);
      }
    }
    return { success: true, value: closed };
  }

  closeAll(price: number): Order[] {
    const closed: Order[] = [];
    for (const order of this.openPositions) {
      const result = this.closePartial(order, price);
      if (result.success) {
        closed.push(result.value);
      }
    }
    return closed;
  }

  checkExits(price: number, orders?: Order[]): Order[] {
    const closed: Order[] = [];
    const toCheck = orders ?? this.openPositions;
    for (const order of toCheck) {
      const target = order.exitTargetAt(price);
      if (target !== null) {
        const result = this.closePartial(
          order,
          target.price,
          target.sizePercent ?? 100,
          this.makerFeePercent,
          target.level
        );
        if (result.success) {
          closed.push(result.value);
        }
      }
    }
    return closed;
  }

  onPrice(price: number): { entries: Order[]; exits: Order[] } {
    const preExistingOpen = this.orders.filter((o) => o.state === 'open');
    const entries = this.checkEntries(price);
    const exits = this.checkExits(price, preExistingOpen);
    return { entries, exits };
  }
}
