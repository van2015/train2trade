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

  abstract fill(price: number, fee: number): Order;
  abstract close(exitPrice: number, fee: number, basis: number): Order;
}
