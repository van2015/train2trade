import type { Result } from '../shared/types/Result';

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

export type OrderState = 'pending' | 'open' | 'closed';

const _longBrand = Symbol('LongOrder');
const _shortBrand = Symbol('ShortOrder');

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

  abstract fill(price: number, fee: number): Order;
  abstract close(exitPrice: number, fee: number, basis: number): Order;

  static open(
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

  static pending(
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
}

export class LongOrder extends Order {
  readonly _brand = _longBrand;
  constructor(
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
  close(exitPrice: number, fee: number, basis: number): LongOrder {
    const pnl =
      this.pnlAt(exitPrice) -
      (this.entryFee ?? 0) * (this.size / basis) -
      fee * (this.size / basis);
    return new LongOrder('closed', this.price, this.size, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: this.entryFee,
      feeBasis: basis,
      exitPrice,
      pnl,
    });
  }
}

export class ShortOrder extends Order {
  readonly _brand = _shortBrand;
  constructor(
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
  fill(price: number, fee: number): ShortOrder {
    return new ShortOrder('open', price, this.size, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: fee,
      feeBasis: this.size,
    });
  }
  close(exitPrice: number, fee: number, basis: number): ShortOrder {
    const pnl =
      this.pnlAt(exitPrice) -
      (this.entryFee ?? 0) * (this.size / basis) -
      fee * (this.size / basis);
    return new ShortOrder('closed', this.price, this.size, {
      stopLoss: this.stopLoss,
      takeProfit: this.takeProfit,
      exitLevels: this.exitLevels,
      entryFee: this.entryFee,
      feeBasis: basis,
      exitPrice,
      pnl,
    });
  }
}

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
    const order = Order.open(input.side, input.price, input.size, {
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      exitLevels: input.exitLevels,
      entryFee: this.takerFeePercent,
      feeBasis: input.size,
    });
    const valid = this.validateOrder(order);
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
    const pending = Order.pending(input.side, input.limitPrice, input.size, {
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
    });
    const valid = this.validateOrder(pending);
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
    const valid = this.validateClose(order, price, sizePercent);
    if (!valid.success) {
      return valid;
    }
    const Ctor = order.side() === 'long' ? LongOrder : ShortOrder;
    const slicePnl =
      order.pnlAt(price) -
      (order.entryFee ?? 0) * this.feeScale(order, order.size) -
      exitFee * this.feeScale(order, order.size);
    if (sizePercent === 100) {
      const closed = new Ctor('closed', order.price, order.size, {
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        exitLevels: order.exitLevels,
        entryFee: order.entryFee,
        feeBasis: order.feeBasis,
        exitPrice: price,
        pnl: slicePnl,
      });
      const index = this.orders.indexOf(order);
      if (index >= 0) {
        this.orders[index] = closed;
      }
      return { success: true, value: closed };
    }
    const sliceSize = (order.size * sizePercent) / 100;
    const sliceClosedPnl =
      order.pnlAt(price) -
      (order.entryFee ?? 0) * this.feeScale(order, sliceSize) -
      exitFee * this.feeScale(order, sliceSize);
    const slice = new Ctor('closed', order.price, sliceSize, {
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      exitLevels: order.exitLevels,
      entryFee: order.entryFee,
      feeBasis: order.feeBasis,
      exitPrice: price,
      pnl: sliceClosedPnl,
    });
    const remainderExitLevels = excludeFromRemainder
      ? order.exitLevels?.filter((l) => l !== excludeFromRemainder)
      : order.exitLevels;
    const remainder = new Ctor('open', order.price, order.size - sliceSize, {
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      exitLevels: remainderExitLevels,
      entryFee: order.entryFee,
      feeBasis: order.feeBasis,
    });
    const index = this.orders.indexOf(order);
    if (index >= 0) {
      this.orders[index] = remainder;
      this.orders.push(slice);
    }
    return { success: true, value: slice };
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
      const target = this.exitAt(order, price);
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

  private validateOrder(order: Order): Result<void, EngineError> {
    const price = this.ensurePositive(order.price, 'INVALID_PRICE');
    if (!price.success) {
      return price;
    }
    const size = this.ensurePositive(order.size, 'INVALID_SIZE');
    if (!size.success) {
      return size;
    }
    if (!order.isValidStopLoss()) {
      return { success: false, error: 'INVALID_STOP_LOSS' };
    }
    if (!order.isValidTakeProfit()) {
      return { success: false, error: 'INVALID_TAKE_PROFIT' };
    }
    if (order.exitLevels) {
      const seenPrices = new Set<number>();
      for (const level of order.exitLevels) {
        const levelErr = order.levelError(level);
        if (levelErr !== null) {
          return { success: false, error: levelErr };
        }
        if (seenPrices.has(level.price)) {
          return { success: false, error: 'DUPLICATE_EXIT_LEVEL' };
        }
        seenPrices.add(level.price);
      }
    }
    return { success: true, value: undefined };
  }

  private validateClose(
    order: Order,
    price: number,
    sizePercent: number
  ): Result<void, EngineError> {
    const exit = this.ensurePositive(price, 'INVALID_PRICE');
    if (!exit.success) {
      return exit;
    }
    if (order.state !== 'open') {
      return { success: false, error: 'POSITION_NOT_OPEN' };
    }
    if (sizePercent <= 0 || sizePercent > 100) {
      return { success: false, error: 'INVALID_SIZE' };
    }
    return { success: true, value: undefined };
  }

  private feeScale(order: Order, sliceSize: number): number {
    return sliceSize / (order.feeBasis ?? order.size);
  }

  private exitAt(
    order: Order,
    price: number
  ): {
    price: number;
    sizePercent: number | null;
    level?: ExitLevel;
  } | null {
    const levels = order.exitLevels;
    if (levels) {
      for (const level of levels) {
        const hit =
          level.kind === 'tp' ? order.isTpHit(price) : order.isSlHit(price);
        if (hit) {
          return { price: level.price, sizePercent: level.sizePercent, level };
        }
      }
    }
    if (order.stopLoss !== undefined && order.isSlHit(price)) {
      return { price: order.stopLoss, sizePercent: null };
    }
    if (order.takeProfit !== undefined && order.isTpHit(price)) {
      return { price: order.takeProfit, sizePercent: null };
    }
    return null;
  }

  private ensurePositive(
    value: number,
    error: EngineError
  ): Result<void, EngineError> {
    return value <= 0
      ? { success: false, error }
      : { success: true, value: undefined };
  }
}
