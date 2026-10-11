import { _shortBrand, Order } from './Order';
import type { EngineError, ExitLevel } from './types';

export class ShortOrder extends Order {
  readonly _brand = _shortBrand;
  constructor(
    state: 'pending' | 'open' | 'closed',
    price: number,
    size: number,
    opts?: {
      stopLoss?: number;
      takeProfit?: number;
      exitLevels?: ExitLevel[];
      entryFee?: number;
      feeBasis?: number;
      exitPrice?: number;
      pnl?: number;
    }
  ) {
    super(state, price, size, opts);
  }
  side() {
    return 'short' as const;
  }
  isTpHit(price: number) {
    return price <= this.price;
  }
  isSlHit(price: number) {
    return price >= this.price;
  }
  pnlAt(exitPrice: number) {
    return -((exitPrice - this.price) / this.price) * 100;
  }
  isValidStopLoss() {
    return this.stopLoss === undefined || this.stopLoss > this.price;
  }
  isValidTakeProfit() {
    return this.takeProfit === undefined || this.takeProfit < this.price;
  }
  canOpen() {
    return this.isValidStopLoss() && this.isValidTakeProfit();
  }
  isTpDirectionValid(price: number): boolean {
    return price < this.price;
  }
  isSlDirectionValid(price: number): boolean {
    return price > this.price;
  }
  tpError(price: number): EngineError | null {
    return this.isTpDirectionValid(price) ? null : 'INVALID_TAKE_PROFIT';
  }
  slError(price: number): EngineError | null {
    return this.isSlDirectionValid(price) ? null : 'INVALID_STOP_LOSS';
  }
  instantiate(
    state: 'open' | 'closed',
    price: number,
    size: number,
    opts: {
      stopLoss?: number;
      takeProfit?: number;
      exitLevels?: ExitLevel[];
      entryFee?: number;
      feeBasis?: number;
      exitPrice?: number;
      pnl?: number;
    }
  ): Order {
    return new ShortOrder(state, price, size, opts);
  }
}
