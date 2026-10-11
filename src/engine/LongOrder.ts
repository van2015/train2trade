import { _longBrand, Order } from './Order';
import type { EngineError, ExitLevel } from './types';

export class LongOrder extends Order {
  readonly _brand = _longBrand;
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
    return 'long' as const;
  }
  isTpHit(price: number) {
    return price >= this.price;
  }
  isSlHit(price: number) {
    return price <= this.price;
  }
  pnlAt(exitPrice: number) {
    return ((exitPrice - this.price) / this.price) * 100;
  }
  isValidStopLoss() {
    return this.stopLoss === undefined || this.stopLoss < this.price;
  }
  isValidTakeProfit() {
    return this.takeProfit === undefined || this.takeProfit > this.price;
  }
  canOpen() {
    return this.isValidStopLoss() && this.isValidTakeProfit();
  }
  isTpDirectionValid(price: number): boolean {
    return price > this.price;
  }
  isSlDirectionValid(price: number): boolean {
    return price < this.price;
  }
  tpError(price: number): EngineError | null {
    return this.isTpDirectionValid(price) ? null : 'INVALID_TAKE_PROFIT';
  }
  slError(price: number): EngineError | null {
    return this.isSlDirectionValid(price) ? null : 'INVALID_STOP_LOSS';
  }
  fill(price: number, fee: number): LongOrder {
    return new LongOrder('open', price, this.size, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: fee,
      feeBasis: this.size,
    });
  }
  close(
    exitPrice: number,
    sizePercent: number,
    exitFee: number,
    basis: number,
    excludeFromRemainder?: ExitLevel
  ): { closed: LongOrder; remainder?: LongOrder } {
    if (sizePercent === 100) {
      const closedPnl =
        this.pnlAt(exitPrice) -
        (this.entryFee ?? 0) * this.feeScale(this.size) -
        exitFee * this.feeScale(this.size);
      const closed = new LongOrder('closed', this.price, this.size, {
        stopLoss: this.stopLoss,
        takeProfit: this.takeProfit,
        exitLevels: this.exitLevels,
        entryFee: this.entryFee,
        feeBasis: basis,
        exitPrice,
        pnl: closedPnl,
      });
      return { closed };
    }
    const sliceSize = (this.size * sizePercent) / 100;
    const sliceClosedPnl =
      this.pnlAt(exitPrice) -
      (this.entryFee ?? 0) * this.feeScale(sliceSize) -
      exitFee * this.feeScale(sliceSize);
    const closed = new LongOrder('closed', this.price, sliceSize, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: this.entryFee,
      feeBasis: basis,
      exitPrice,
      pnl: sliceClosedPnl,
    });
    const remainderExitLevels = excludeFromRemainder
      ? this.exitLevels?.filter((l) => l !== excludeFromRemainder)
      : this.exitLevels;
    const remainder = new LongOrder('open', this.price, this.size - sliceSize, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: remainderExitLevels,
      entryFee: this.entryFee,
      feeBasis: basis,
    });
    return { closed, remainder };
  }
}
