import type { EngineError, ExitLevel, OrderState, Result } from './types';

export const _longBrand = Symbol('LongOrder');
export const _shortBrand = Symbol('ShortOrder');

export abstract class Order {
  readonly state: OrderState;
  readonly price: number;
  readonly size: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly exitLevels?: ExitLevel[];
  readonly entryFee?: number;
  readonly feeBasis?: number;
  readonly exitPrice?: number;
  readonly pnl?: number;

  abstract readonly _brand: symbol;
  abstract side(): 'long' | 'short';
  abstract isTpHit(price: number): boolean;
  abstract isSlHit(price: number): boolean;
  abstract pnlAt(exitPrice: number): number;
  abstract isValidStopLoss(): boolean;
  abstract isValidTakeProfit(): boolean;
  abstract canOpen(): boolean;
  abstract isTpDirectionValid(price: number): boolean;
  abstract isSlDirectionValid(price: number): boolean;
  abstract tpError(price: number): EngineError | null;
  abstract slError(price: number): EngineError | null;
  abstract instantiate(
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
  ): Order;

  protected constructor(
    state: OrderState,
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
    this.state = state;
    this.price = price;
    this.size = size;
    this.stopLoss = opts?.stopLoss;
    this.takeProfit = opts?.takeProfit;
    this.exitLevels = opts?.exitLevels;
    this.entryFee = opts?.entryFee;
    this.feeBasis = opts?.feeBasis;
    this.exitPrice = opts?.exitPrice;
    this.pnl = opts?.pnl;
  }

  isValidLevel(level: ExitLevel): boolean {
    if (level.price <= 0) return false;
    if (level.sizePercent <= 0 || level.sizePercent > 100) return false;
    return level.kind === 'tp'
      ? this.isTpDirectionValid(level.price)
      : this.isSlDirectionValid(level.price);
  }

  levelError(level: ExitLevel): EngineError | null {
    if (level.price <= 0) return 'INVALID_PRICE';
    if (level.sizePercent <= 0 || level.sizePercent > 100)
      return 'INVALID_SIZE';
    return level.kind === 'tp'
      ? this.tpError(level.price)
      : this.slError(level.price);
  }

  exitTargetAt(price: number): {
    price: number;
    sizePercent: number | null;
    level?: ExitLevel;
  } | null {
    const levels = this.exitLevels;
    if (levels) {
      for (const level of levels) {
        const hit =
          level.kind === 'tp' ? this.isTpHit(price) : this.isSlHit(price);
        if (hit) {
          return { price: level.price, sizePercent: level.sizePercent, level };
        }
      }
    }
    if (this.stopLoss !== undefined && this.isSlHit(price)) {
      return { price: this.stopLoss, sizePercent: null };
    }
    if (this.takeProfit !== undefined && this.isTpHit(price)) {
      return { price: this.takeProfit, sizePercent: null };
    }
    return null;
  }

  validateOpen(): Result<void, EngineError> {
    if (this.price <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    if (this.size <= 0) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    if (!this.isValidStopLoss()) {
      return { success: false, error: 'INVALID_STOP_LOSS' };
    }
    if (!this.isValidTakeProfit()) {
      return { success: false, error: 'INVALID_TAKE_PROFIT' };
    }
    if (this.exitLevels) {
      const seen = new Set<number>();
      for (const level of this.exitLevels) {
        const err = this.levelError(level);
        if (err !== null) {
          return { success: false, error: err };
        }
        if (seen.has(level.price)) {
          return { success: false, error: 'DUPLICATE_EXIT_LEVEL' };
        }
        seen.add(level.price);
      }
    }
    return { success: true, value: undefined };
  }

  validateClose(price: number, sizePercent: number): Result<void, EngineError> {
    if (price <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    if (this.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    if (sizePercent <= 0 || sizePercent > 100) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    return { success: true, value: undefined };
  }

  removeExitLevel(index: number): Result<Order, EngineError> {
    if (!this.exitLevels || this.exitLevels.length === 0) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    if (index < 0 || index >= this.exitLevels.length) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    const newExitLevels = this.exitLevels.filter((_, i) => i !== index);
    const newOrder = this.instantiate(
      this.state as 'open' | 'closed',
      this.price,
      this.size,
      {
        stopLoss: this.stopLoss,
        takeProfit: this.takeProfit,
        exitLevels: newExitLevels,
        entryFee: this.entryFee,
        feeBasis: this.feeBasis,
      }
    );
    return { success: true, value: newOrder };
  }

  moveExitLevel(index: number, newPrice: number): Result<Order, EngineError> {
    if (!this.exitLevels || this.exitLevels.length === 0) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    if (index < 0 || index >= this.exitLevels.length) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    if (newPrice <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    const level = this.exitLevels[index];
    const newLevel = { ...level, price: newPrice };
    const valid = this.isValidLevel(newLevel);
    if (!valid) {
      return {
        success: false,
        error:
          level.kind === 'tp' ? 'INVALID_TAKE_PROFIT' : 'INVALID_STOP_LOSS',
      };
    }
    const newExitLevels = this.exitLevels.map((l, i) =>
      i === index ? newLevel : l
    );
    const newOrder = this.instantiate(
      this.state as 'open' | 'closed',
      this.price,
      this.size,
      {
        stopLoss: this.stopLoss,
        takeProfit: this.takeProfit,
        exitLevels: newExitLevels,
        entryFee: this.entryFee,
        feeBasis: this.feeBasis,
      }
    );
    return { success: true, value: newOrder };
  }

  protected feeScale(sliceSize: number): number {
    return sliceSize / (this.feeBasis ?? this.size);
  }

  protected calcClosedPnl(
    exitPrice: number,
    sliceSize: number,
    exitFee: number
  ): number {
    return (
      this.pnlAt(exitPrice) -
      (this.entryFee ?? 0) * this.feeScale(sliceSize) -
      exitFee * this.feeScale(sliceSize)
    );
  }

  fill(price: number, fee: number): Order {
    return this.instantiate('open', price, this.size, {
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
  ): { closed: Order; remainder?: Order } {
    const targetSize =
      sizePercent === 100 ? this.size : (this.size * sizePercent) / 100;
    const closedPnl = this.calcClosedPnl(exitPrice, targetSize, exitFee);
    const closed = this.instantiate('closed', this.price, targetSize, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: this.entryFee,
      feeBasis: basis,
      exitPrice,
      pnl: closedPnl,
    });
    if (sizePercent === 100) {
      return { closed };
    }
    const remainderExitLevels = excludeFromRemainder
      ? this.exitLevels?.filter((l) => l !== excludeFromRemainder)
      : this.exitLevels;
    const remainder = this.instantiate(
      'open',
      this.price,
      this.size - targetSize,
      {
        stopLoss: this.stopLoss,
        takeProfit: this.takeProfit,
        exitLevels: remainderExitLevels,
        entryFee: this.entryFee,
        feeBasis: basis,
      }
    );
    return { closed, remainder };
  }
}
