import type { Result } from '../shared/types/Result';

export type Side = 'long' | 'short';

export type EngineError =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INVALID_STOP_LOSS'
  | 'INVALID_TAKE_PROFIT'
  | 'DUPLICATE_EXIT_LEVEL'
  | 'POSITION_NOT_OPEN';

export type ExitLevelKind = 'tp' | 'sl';

export interface ExitLevel {
  kind: ExitLevelKind;
  price: number;
  sizePercent: number;
}

interface ExitTarget {
  price: number;
  sizePercent: number | null;
  level?: ExitLevel;
}

export interface OpenOrder {
  side: Side;
  price: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
  exitLevels?: ExitLevel[];
}

export interface PendingOrder {
  side: Side;
  limitPrice: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface EngineOptions {
  makerFeePercent?: number;
  takerFeePercent?: number;
}

export interface Position {
  side: Side;
  entryPrice: number;
  size: number;
  state: 'open' | 'closed';
  exitPrice?: number;
  pnl?: number;
  stopLoss?: number;
  takeProfit?: number;
  entryFee?: number;
  feeBasis?: number;
  exitLevels?: ExitLevel[];
}

export class TradingEngine {
  private readonly positions: Position[] = [];
  private readonly pending: PendingOrder[] = [];
  private readonly makerFeePercent: number;
  private readonly takerFeePercent: number;

  constructor(options: EngineOptions = {}) {
    this.makerFeePercent = options.makerFeePercent ?? 0;
    this.takerFeePercent = options.takerFeePercent ?? 0;
  }

  get pendingOrders(): PendingOrder[] {
    return [...this.pending];
  }

  get openPositions(): Position[] {
    return this.positions.filter((p) => p.state === 'open');
  }

  get closedPositions(): Position[] {
    return this.positions.filter((p) => p.state === 'closed');
  }

  get totalPnl(): number {
    return this.closedPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  }

  unrealizedPnl(price: number): number {
    return this.openPositions.reduce(
      (sum, p) => sum + this.calcPnl(p, price),
      0
    );
  }

  equity(price: number): number {
    return this.totalPnl + this.unrealizedPnl(price);
  }

  open(order: OpenOrder): Result<Position, EngineError> {
    return this.openWithFee(order, this.takerFeePercent);
  }

  private openWithFee(
    order: OpenOrder,
    entryFee: number
  ): Result<Position, EngineError> {
    const valid = this.validateOrder(order);
    if (!valid.success) {
      return valid;
    }
    const position: Position = {
      side: order.side,
      entryPrice: order.price,
      size: order.size,
      state: 'open',
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      entryFee,
      feeBasis: order.size,
      exitLevels: order.exitLevels,
    };
    this.positions.push(position);
    return { success: true, value: position };
  }

  placeLimitOrder(order: PendingOrder): Result<PendingOrder, EngineError> {
    const valid = this.validateOrder({
      side: order.side,
      price: order.limitPrice,
      size: order.size,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
    });
    if (!valid.success) {
      return valid;
    }
    this.pending.push(order);
    return { success: true, value: order };
  }

  cancelLimitOrder(order: PendingOrder): boolean {
    const index = this.pending.indexOf(order);
    if (index < 0) {
      return false;
    }
    this.pending.splice(index, 1);
    return true;
  }

  checkEntries(price: number): Position[] {
    const filled: Position[] = [];
    const filledOrders: PendingOrder[] = [];
    for (const order of this.pending) {
      const hit =
        order.side === 'long'
          ? price <= order.limitPrice
          : price >= order.limitPrice;
      if (hit) {
        const result = this.openWithFee(
          {
            side: order.side,
            price: order.limitPrice,
            size: order.size,
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
          },
          this.makerFeePercent
        );
        if (result.success) {
          filled.push(result.value);
          filledOrders.push(order);
        }
      }
    }
    for (const order of filledOrders) {
      this.pending.splice(this.pending.indexOf(order), 1);
    }
    return filled;
  }

  private validateOrder(order: OpenOrder): Result<void, EngineError> {
    const price = this.ensurePositive(order.price, 'INVALID_PRICE');
    if (!price.success) {
      return price;
    }
    const size = this.ensurePositive(order.size, 'INVALID_SIZE');
    if (!size.success) {
      return size;
    }
    if (this.isInvalidStop(order)) {
      return { success: false, error: 'INVALID_STOP_LOSS' };
    }
    if (this.isInvalidTakeProfit(order)) {
      return { success: false, error: 'INVALID_TAKE_PROFIT' };
    }
    if (order.exitLevels) {
      const seenPrices = new Set<number>();
      for (const level of order.exitLevels) {
        const levelValid = this.validateExitLevel(
          level,
          order.side,
          order.price,
          order.size
        );
        if (!levelValid.success) {
          return levelValid;
        }
        if (seenPrices.has(level.price)) {
          return { success: false, error: 'DUPLICATE_EXIT_LEVEL' };
        }
        seenPrices.add(level.price);
      }
    }
    return { success: true, value: undefined };
  }

  private isInvalidStop(order: OpenOrder): boolean {
    if (order.stopLoss === undefined) {
      return false;
    }
    return order.side === 'long'
      ? order.stopLoss >= order.price
      : order.stopLoss <= order.price;
  }

  private isInvalidTakeProfit(order: OpenOrder): boolean {
    if (order.takeProfit === undefined) {
      return false;
    }
    return order.side === 'long'
      ? order.takeProfit <= order.price
      : order.takeProfit >= order.price;
  }

  private validateExitLevel(
    level: ExitLevel,
    side: Side,
    price: number,
    size: number
  ): Result<void, EngineError> {
    if (level.price <= 0) {
      return { success: false, error: 'INVALID_PRICE' };
    }
    if (level.sizePercent <= 0 || level.sizePercent > 100) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    const invalid =
      level.kind === 'tp'
        ? this.isInvalidTakeProfit({
            side,
            price,
            size,
            takeProfit: level.price,
          })
        : this.isInvalidStop({ side, price, size, stopLoss: level.price });
    if (invalid) {
      return {
        success: false,
        error:
          level.kind === 'tp' ? 'INVALID_TAKE_PROFIT' : 'INVALID_STOP_LOSS',
      };
    }
    return { success: true, value: undefined };
  }

  close(position: Position, price: number): Result<Position, EngineError> {
    return this.closePartial(position, price);
  }

  closePartial(
    position: Position,
    price: number,
    sizePercent: number = 100,
    exitFee: number = this.takerFeePercent,
    excludeFromRemainder?: ExitLevel
  ): Result<Position, EngineError> {
    const exit = this.ensurePositive(price, 'INVALID_PRICE');
    if (!exit.success) {
      return exit;
    }
    if (position.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    if (sizePercent <= 0 || sizePercent > 100) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    if (sizePercent === 100) {
      const closed: Position = {
        ...position,
        state: 'closed',
        exitPrice: price,
        pnl:
          this.calcPnl(position, price) -
          (position.entryFee ?? 0) * this.feeScale(position, position.size) -
          exitFee * this.feeScale(position, position.size),
      };
      const index = this.positions.indexOf(position);
      if (index >= 0) {
        this.positions[index] = closed;
      }
      return { success: true, value: closed };
    }
    const sliceSize = (position.size * sizePercent) / 100;
    const slice: Position = {
      ...position,
      size: sliceSize,
      state: 'closed',
      exitPrice: price,
      pnl:
        this.calcPnl(position, price) -
        (position.entryFee ?? 0) * this.feeScale(position, sliceSize) -
        exitFee * this.feeScale(position, sliceSize),
    };
    const remainder: Position = {
      ...position,
      size: position.size - sliceSize,
      exitLevels: excludeFromRemainder
        ? position.exitLevels?.filter((l) => l !== excludeFromRemainder)
        : position.exitLevels,
    };
    const index = this.positions.indexOf(position);
    if (index >= 0) {
      this.positions[index] = remainder;
      this.positions.push(slice);
    }
    return { success: true, value: slice };
  }

  private feeScale(position: Position, sliceSize: number): number {
    return sliceSize / (position.feeBasis ?? position.size);
  }

  closeAll(price: number): Position[] {
    return this.closeEach(
      () => ({ price, sizePercent: null }),
      this.takerFeePercent
    );
  }

  checkExits(price: number): Position[] {
    return this.closeEach(
      (position) => this.exitAt(position, price),
      this.makerFeePercent
    );
  }

  onPrice(price: number): { entries: Position[]; exits: Position[] } {
    const entries = this.checkEntries(price);
    const exits = this.checkExits(price);
    return { entries, exits };
  }

  private closeEach(
    locateExit: (position: Position) => ExitTarget | null,
    exitFee: number
  ): Position[] {
    const closed: Position[] = [];
    for (const position of this.openPositions) {
      const target = locateExit(position);
      if (target !== null) {
        const result = this.closePartial(
          position,
          target.price,
          target.sizePercent ?? 100,
          exitFee,
          target.level
        );
        if (result.success) {
          closed.push(result.value);
        }
      }
    }
    return closed;
  }

  private exitAt(position: Position, price: number): ExitTarget | null {
    const levels = position.exitLevels;
    if (levels) {
      for (const level of levels) {
        if (this.isLevelHit(position, level, price)) {
          return { price: level.price, sizePercent: level.sizePercent, level };
        }
      }
    }
    const { stopLoss, takeProfit } = position;
    if (stopLoss !== undefined && this.isStopHit(position, price)) {
      return { price: stopLoss, sizePercent: null };
    }
    if (takeProfit !== undefined && this.isTakeProfitHit(position, price)) {
      return { price: takeProfit, sizePercent: null };
    }
    return null;
  }

  private isLevelHit(
    position: Position,
    level: ExitLevel,
    price: number
  ): boolean {
    return this.hitAt(position.side, price, level.price, level.kind === 'tp');
  }

  private isStopHit(position: Position, price: number): boolean {
    if (position.stopLoss === undefined) {
      return false;
    }
    return this.hitAt(position.side, price, position.stopLoss, false);
  }

  private isTakeProfitHit(position: Position, price: number): boolean {
    if (position.takeProfit === undefined) {
      return false;
    }
    return this.hitAt(position.side, price, position.takeProfit, true);
  }

  private hitAt(
    side: Side,
    price: number,
    threshold: number,
    favorTp: boolean
  ): boolean {
    return favorTp
      ? side === 'long'
        ? price >= threshold
        : price <= threshold
      : side === 'long'
        ? price <= threshold
        : price >= threshold;
  }

  private ensurePositive(
    value: number,
    error: EngineError
  ): Result<void, EngineError> {
    return value <= 0
      ? { success: false, error }
      : { success: true, value: undefined };
  }

  private calcPnl(position: Position, exitPrice: number): number {
    const pct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    return position.side === 'short' ? -pct : pct;
  }
}
