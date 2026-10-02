import { TradeView } from '../types/backtest';
import { TradeState, Side } from '../types/TradeEnums';
import { PriceData } from '../../shared/types/asset';

interface StopLossLevel {
  price: number;
  size: number;
}

interface TakeProfitLevel {
  price: number;
  size: number;
}

export class Trade {
  readonly id: string;
  readonly side: Side;

  private _state: TradeState;
  private _size = 0;
  private _openedSize = 0;
  private _averageEntry = 0;
  private _markPrice?: number;
  private _realizedPnl = 0;
  private _initialStopLoss?: number;
  private _initialAverageEntry?: number;
  private _initialSize?: number;
  private readonly _stopLosses: StopLossLevel[] = [];
  private readonly _takeProfits: TakeProfitLevel[] = [];

  constructor(id: string, side: Side) {
    this._state = TradeState.Pending;
    this.id = id;
    this.side = side;
  }

  get state(): TradeState {
    return this._state;
  }

  get size(): number {
    return this._size;
  }

  get averageEntry(): number {
    return this._averageEntry;
  }

  get markPrice(): number | undefined {
    return this._markPrice;
  }

  get realizedPnl(): number {
    return this._realizedPnl;
  }

  get realizedPnlPercent(): number {
    if (this._averageEntry === 0) return 0;
    return (this._realizedPnl / this._averageEntry) * 100;
  }

  get unrealizedPnl(): number {
    if (this._markPrice === undefined) {
      throw new Error(`Trade ${this.id}: mark price not set - call processCandle first`);
    }
    return (this._markPrice - this._averageEntry) * this._size * Trade.directionFactor(this.side);
  }

  get unrealizedPnlPercent(): number {
    if (this._markPrice === undefined) {
      throw new Error(`Trade ${this.id}: mark price not set - call processCandle first`);
    }
    if (this._averageEntry === 0) return 0;
    return (
      ((this._markPrice - this._averageEntry) / this._averageEntry) *
      100 *
      Trade.directionFactor(this.side)
    );
  }

  get initialStopLoss(): number | undefined {
    return this._initialStopLoss;
  }

  get openedSize(): number {
    return this._openedSize;
  }

  get riskAmount(): number | undefined {
    if (
      this._initialStopLoss === undefined ||
      this._initialAverageEntry === undefined ||
      this._initialSize === undefined ||
      this._initialSize === 0
    ) {
      return undefined;
    }
    const risk = Math.abs(this._initialAverageEntry - this._initialStopLoss) * this._initialSize;
    return risk === 0 ? undefined : risk;
  }

  get rMultiple(): number | undefined {
    const risk = this.riskAmount;
    if (risk === undefined) return undefined;
    return this._realizedPnl / risk;
  }

  open(price: number, size: number): void {
    if (this._state !== TradeState.Pending) {
      throw new Error(`Trade ${this.id} is already open`);
    }
    if (size <= 0) throw new Error('Open size must be positive');

    this._averageEntry = price;
    this._size = size;
    this._openedSize = size;
    this._initialAverageEntry = price;
    this._initialSize = size;
    this._state = TradeState.Open;
  }

  addSize(size: number): void {
    this.assertNotClosed();
    if (this._state !== TradeState.Open) {
      throw new Error(`Trade ${this.id} is not open`);
    }
    if (size <= 0) throw new Error('Size must be positive');

    const fillPrice = this._markPrice ?? this._averageEntry;
    const newSize = this._size + size;
    this._averageEntry = (this._size * this._averageEntry + size * fillPrice) / newSize;
    this._size = newSize;
    this._openedSize += size;
  }

  addStopLoss(price: number, size: number): void {
    this.assertNotClosed();
    if (size < 0) throw new Error('Stop loss size must be non-negative');
    if (size === 0) return;

    this._stopLosses.push({ price, size });
    if (this._initialStopLoss === undefined) {
      this._initialStopLoss = price;
    }
  }

  addTakeProfit(price: number, size: number): void {
    this.assertNotClosed();
    if (size < 0) throw new Error('Take profit size must be non-negative');
    if (size === 0) return;

    this._takeProfits.push({ price, size });
  }

  updateStopLoss(index: number, newSize: number): void {
    this.assertNotClosed();
    if (index < 0 || index >= this._stopLosses.length) {
      throw new Error(`Invalid stop loss index: ${index}`);
    }
    if (newSize < 0) throw new Error('Stop loss size must be non-negative');

    if (newSize === 0) {
      this._stopLosses.splice(index, 1);
    } else {
      this._stopLosses[index].size = newSize;
    }
  }

  updateTakeProfit(index: number, newSize: number): void {
    this.assertNotClosed();
    if (index < 0 || index >= this._takeProfits.length) {
      throw new Error(`Invalid take profit index: ${index}`);
    }
    if (newSize < 0) throw new Error('Take profit size must be non-negative');

    if (newSize === 0) {
      this._takeProfits.splice(index, 1);
    } else {
      this._takeProfits[index].size = newSize;
    }
  }

  getStopLosses(): readonly StopLossLevel[] {
    return this._stopLosses;
  }

  getTakeProfits(): readonly TakeProfitLevel[] {
    return this._takeProfits;
  }

  processCandle(bar: PriceData): void {
    if (this._state !== TradeState.Open) return;
    if (this._stopLosses.length === 0 && this._takeProfits.length === 0) {
      this._markPrice = bar.close;
      return;
    }

    this._markPrice = bar.close;

    const long = this.side === Side.Long;
    const slHit =
      this._stopLosses.length > 0 &&
      this._stopLosses.some(sl => (long ? bar.low <= sl.price : bar.high >= sl.price));
    const tpHit =
      this._takeProfits.length > 0 &&
      this._takeProfits.some(tp => (long ? bar.high >= tp.price : bar.low <= tp.price));

    if (slHit && tpHit) {
      throw new Error(
        `Trade ${this.id}: ambiguous candle - both SL and TP would execute in same candle`
      );
    }

    if (slHit) this._executeStopLosses(bar, long);
    if (tpHit) this._executeTakeProfits(bar, long);
  }

  close(size: number, price?: number): void {
    this.assertNotClosed();
    if (size <= 0) throw new Error('Close size must be positive');
    if (size > this._size) throw new Error('Close size exceeds position size');
    const execPrice = price ?? this._markPrice;
    if (execPrice === undefined) {
      throw new Error(`Trade ${this.id}: mark price not set - call processCandle first`);
    }

    this._realizedPnl +=
      (execPrice - this._averageEntry) * size * Trade.directionFactor(this.side);
    this._size -= size;

    if (this._size === 0) {
      this._state = TradeState.Closed;
    }
  }

  closeAll(): void {
    if (this._state !== TradeState.Open) return;
    this.close(this._size);
  }

  toView(): TradeView {
    return {
      id: this.id,
      side: this.side,
      state: this._state,
      size: this._size,
      averageEntry: this._averageEntry,
      stopLoss: this._stopLosses[0]?.price,
      takeProfit: this._takeProfits[0]?.price,
      realizedPnl: this._realizedPnl,
      rMultiple: this.rMultiple,
    };
  }

  private static directionFactor(side: Side): number {
    return side === Side.Long ? 1 : -1;
  }

  private _executeStopLosses(bar: PriceData, long: boolean): void {
    for (const sl of [...this._stopLosses]) {
      if (this._state !== TradeState.Open) break;
      const triggered = long ? bar.low <= sl.price : bar.high >= sl.price;
      if (!triggered) continue;

      const closeSize = Math.min(sl.size, this._size);
      this._realizedPnl +=
        (sl.price - this._averageEntry) * closeSize * Trade.directionFactor(this.side);
      this._size -= closeSize;

      sl.size -= closeSize;
      if (sl.size === 0) {
        const idx = this._stopLosses.indexOf(sl);
        if (idx !== -1) this._stopLosses.splice(idx, 1);
      }

      if (this._size === 0) {
        this._state = TradeState.Closed;
      }
    }
  }

  private _executeTakeProfits(bar: PriceData, long: boolean): void {
    for (const tp of [...this._takeProfits]) {
      if (this._state !== TradeState.Open) break;
      const triggered = long ? bar.high >= tp.price : bar.low <= tp.price;
      if (!triggered) continue;

      const closeSize = Math.min(tp.size, this._size);
      this._realizedPnl +=
        (tp.price - this._averageEntry) * closeSize * Trade.directionFactor(this.side);
      this._size -= closeSize;

      tp.size -= closeSize;
      if (tp.size === 0) {
        const idx = this._takeProfits.indexOf(tp);
        if (idx !== -1) this._takeProfits.splice(idx, 1);
      }

      if (this._size === 0) {
        this._state = TradeState.Closed;
      }
    }
  }

  private assertNotClosed(): void {
    if (this._state === TradeState.Closed) {
      throw new Error(`Trade ${this.id} is closed and cannot be modified`);
    }
  }
}
