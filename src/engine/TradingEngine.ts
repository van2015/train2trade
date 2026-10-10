import type { Result } from '../shared/types/Result';

export type Side = 'long' | 'short';

export type EngineError =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INVALID_STOP_LOSS'
  | 'INVALID_TAKE_PROFIT'
  | 'POSITION_NOT_OPEN';

export interface OpenOrder {
  side: Side;
  price: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
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

  close(position: Position, price: number): Result<Position, EngineError> {
    return this.closeWithFee(position, price, this.takerFeePercent);
  }

  closePartial(
    position: Position,
    price: number,
    sizePercent: number,
    exitFee: number = this.takerFeePercent
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
    const sliceSize = (position.size * sizePercent) / 100;
    const feeScale = sliceSize / (position.feeBasis ?? position.size);
    const remainder: Position = {
      ...position,
      size: position.size - sliceSize,
    };
    const slice: Position = {
      ...position,
      size: sliceSize,
      state: 'closed',
      exitPrice: price,
      pnl:
        this.calcPnl(position, price) -
        (position.entryFee ?? 0) * feeScale -
        exitFee * feeScale,
    };
    const index = this.positions.indexOf(position);
    if (index >= 0) {
      this.positions[index] = remainder;
    }
    this.positions.push(slice);
    return { success: true, value: slice };
  }

  private feeScale(position: Position): number {
    return position.size / (position.feeBasis ?? position.size);
  }

  private closeWithFee(
    position: Position,
    price: number,
    exitFee: number
  ): Result<Position, EngineError> {
    const exit = this.ensurePositive(price, 'INVALID_PRICE');
    if (!exit.success) {
      return exit;
    }
    if (position.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    const closed: Position = {
      ...position,
      state: 'closed',
      exitPrice: price,
      pnl:
        this.calcPnl(position, price) -
        (position.entryFee ?? 0) * this.feeScale(position) -
        exitFee * this.feeScale(position),
    };
    const index = this.positions.indexOf(position);
    if (index >= 0) {
      this.positions[index] = closed;
    }
    return { success: true, value: closed };
  }

  closeAll(price: number): Position[] {
    return this.closeEach(() => price, this.takerFeePercent);
  }

  checkExits(price: number): Position[] {
    return this.closeEach(
      (position) => this.exitPriceAt(position, price),
      this.makerFeePercent
    );
  }

  onPrice(price: number): { entries: Position[]; exits: Position[] } {
    const entries = this.checkEntries(price);
    const exits = this.checkExits(price);
    return { entries, exits };
  }

  private closeEach(
    locateExit: (position: Position) => number | null,
    exitFee: number
  ): Position[] {
    const closed: Position[] = [];
    for (const position of this.openPositions) {
      const exitPrice = locateExit(position);
      if (exitPrice !== null) {
        const result = this.closeWithFee(position, exitPrice, exitFee);
        if (result.success) {
          closed.push(result.value);
        }
      }
    }
    return closed;
  }

  private exitPriceAt(position: Position, price: number): number | null {
    const { stopLoss, takeProfit } = position;
    if (stopLoss !== undefined && this.isStopHit(position, price)) {
      return stopLoss;
    }
    if (takeProfit !== undefined && this.isTakeProfitHit(position, price)) {
      return takeProfit;
    }
    return null;
  }

  private isStopHit(position: Position, price: number): boolean {
    if (position.stopLoss === undefined) {
      return false;
    }
    return position.side === 'long'
      ? price <= position.stopLoss
      : price >= position.stopLoss;
  }

  private isTakeProfitHit(position: Position, price: number): boolean {
    if (position.takeProfit === undefined) {
      return false;
    }
    return position.side === 'long'
      ? price >= position.takeProfit
      : price <= position.takeProfit;
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
