import type { PriceData } from '../../shared/types/asset';
import type { Result } from '../../shared/types/Result';
import type { TradeView } from '../types/backtest';
import { Side, TradeState } from '../types/TradeEnums';
import type { TradeError } from '../types/TradeError';

interface PriceLevel {
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
  private readonly _stopLosses: PriceLevel[] = [];
  private readonly _takeProfits: PriceLevel[] = [];

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

  get unrealizedPnl(): Result<number, TradeError> {
    if (this._markPrice === undefined) {
      return { success: false, error: { type: 'MARK_PRICE_NOT_SET' } };
    }
    return {
      success: true,
      value:
        (this._markPrice - this._averageEntry) *
        this._size *
        Trade.directionFactor(this.side),
    };
  }

  get unrealizedPnlPercent(): Result<number, TradeError> {
    if (this._markPrice === undefined) {
      return { success: false, error: { type: 'MARK_PRICE_NOT_SET' } };
    }
    if (this._averageEntry === 0) return { success: true, value: 0 };
    return {
      success: true,
      value:
        ((this._markPrice - this._averageEntry) / this._averageEntry) *
        100 *
        Trade.directionFactor(this.side),
    };
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
    const risk =
      Math.abs(this._initialAverageEntry - this._initialStopLoss) *
      this._initialSize;
    return risk === 0 ? undefined : risk;
  }

  get rMultiple(): number | undefined {
    const risk = this.riskAmount;
    if (risk === undefined) return undefined;
    return this._realizedPnl / risk;
  }

  open(price: number, size: number): Result<void, TradeError> {
    if (this._state !== TradeState.Pending) {
      return {
        success: false,
        error: { type: 'TRADE_ALREADY_OPEN', id: this.id },
      };
    }
    if (size <= 0) {
      return { success: false, error: { type: 'INVALID_SIZE', size } };
    }

    this._averageEntry = price;
    this._size = size;
    this._openedSize = size;
    this._initialAverageEntry = price;
    this._initialSize = size;
    this._state = TradeState.Open;
    return { success: true, value: undefined };
  }

  addSize(size: number): Result<void, TradeError> {
    if (this._state === TradeState.Closed) {
      return { success: false, error: { type: 'TRADE_CLOSED', id: this.id } };
    }
    if (this._state !== TradeState.Open) {
      return { success: false, error: { type: 'TRADE_NOT_OPEN', id: this.id } };
    }
    if (size <= 0) {
      return { success: false, error: { type: 'INVALID_SIZE', size } };
    }

    const fillPrice = this._markPrice ?? this._averageEntry;
    const newSize = this._size + size;
    this._averageEntry =
      (this._size * this._averageEntry + size * fillPrice) / newSize;
    this._size = newSize;
    this._openedSize += size;
    return { success: true, value: undefined };
  }

  addStopLoss(price: number, size: number): Result<void, TradeError> {
    const result = this.addLevel(
      this._stopLosses,
      price,
      size,
      'INVALID_STOP_LOSS_SIZE'
    );
    if (result.success && size > 0 && this._initialStopLoss === undefined) {
      this._initialStopLoss = price;
    }
    return result;
  }

  addTakeProfit(price: number, size: number): Result<void, TradeError> {
    return this.addLevel(
      this._takeProfits,
      price,
      size,
      'INVALID_TAKE_PROFIT_SIZE'
    );
  }

  private addLevel(
    levels: PriceLevel[],
    price: number,
    size: number,
    errorType: 'INVALID_STOP_LOSS_SIZE' | 'INVALID_TAKE_PROFIT_SIZE'
  ): Result<void, TradeError> {
    if (this._state === TradeState.Closed) {
      return { success: false, error: { type: 'TRADE_CLOSED', id: this.id } };
    }
    if (size < 0) {
      return { success: false, error: { type: errorType, size } };
    }
    if (size === 0) return { success: true, value: undefined };

    levels.push({ price, size });
    return { success: true, value: undefined };
  }

  updateStopLoss(index: number, newSize: number): Result<void, TradeError> {
    return this.updateLevel(
      this._stopLosses,
      index,
      newSize,
      'INVALID_STOP_LOSS_SIZE'
    );
  }

  updateTakeProfit(index: number, newSize: number): Result<void, TradeError> {
    return this.updateLevel(
      this._takeProfits,
      index,
      newSize,
      'INVALID_TAKE_PROFIT_SIZE'
    );
  }

  private updateLevel(
    levels: PriceLevel[],
    index: number,
    newSize: number,
    errorType: 'INVALID_STOP_LOSS_SIZE' | 'INVALID_TAKE_PROFIT_SIZE'
  ): Result<void, TradeError> {
    if (this._state === TradeState.Closed) {
      return { success: false, error: { type: 'TRADE_CLOSED', id: this.id } };
    }
    if (index < 0 || index >= levels.length) {
      return {
        success: false,
        error: { type: 'INVALID_INDEX', index, maxIndex: levels.length - 1 },
      };
    }
    if (newSize < 0) {
      return { success: false, error: { type: errorType, size: newSize } };
    }

    if (newSize === 0) {
      levels.splice(index, 1);
    } else {
      levels[index].size = newSize;
    }
    return { success: true, value: undefined };
  }

  getStopLosses(): readonly PriceLevel[] {
    return this._stopLosses;
  }

  getTakeProfits(): readonly PriceLevel[] {
    return this._takeProfits;
  }

  processCandle(bar: PriceData): Result<void, TradeError> {
    if (this._state !== TradeState.Open)
      return { success: true, value: undefined };
    this._markPrice = bar.close;

    if (this._stopLosses.length === 0 && this._takeProfits.length === 0) {
      return { success: true, value: undefined };
    }

    const long = this.side === Side.Long;
    const slHit =
      this._stopLosses.length > 0 &&
      this._stopLosses.some((sl) =>
        long ? bar.low <= sl.price : bar.high >= sl.price
      );
    const tpHit =
      this._takeProfits.length > 0 &&
      this._takeProfits.some((tp) =>
        long ? bar.high >= tp.price : bar.low <= tp.price
      );

    if (slHit && tpHit) {
      return {
        success: false,
        error: { type: 'AMBIGUOUS_CANDLE', id: this.id },
      };
    }

    if (slHit) this.executeLevels(this._stopLosses, bar, long, true);
    if (tpHit) this.executeLevels(this._takeProfits, bar, long, false);
    return { success: true, value: undefined };
  }

  close(size: number, price?: number): Result<void, TradeError> {
    if (this._state === TradeState.Closed) {
      return { success: false, error: { type: 'TRADE_CLOSED', id: this.id } };
    }
    if (this._state !== TradeState.Open) {
      return { success: false, error: { type: 'TRADE_NOT_OPEN', id: this.id } };
    }
    if (size <= 0) {
      return { success: false, error: { type: 'INVALID_SIZE', size } };
    }
    if (size > this._size) {
      return {
        success: false,
        error: {
          type: 'CLOSE_SIZE_EXCEEDS_POSITION',
          requested: size,
          available: this._size,
        },
      };
    }
    const execPrice = price ?? this._markPrice;
    if (execPrice === undefined) {
      return { success: false, error: { type: 'MARK_PRICE_NOT_SET' } };
    }

    this._realizedPnl +=
      (execPrice - this._averageEntry) *
      size *
      Trade.directionFactor(this.side);
    this._size -= size;

    if (this._size === 0) {
      this._state = TradeState.Closed;
    }
    return { success: true, value: undefined };
  }

  closeAll(): Result<void, TradeError> {
    if (this._state !== TradeState.Open)
      return { success: true, value: undefined };
    return this.close(this._size);
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

  private executeLevels(
    levels: PriceLevel[],
    bar: PriceData,
    long: boolean,
    isStopLoss: boolean
  ): void {
    for (const level of [...levels]) {
      if (this._state !== TradeState.Open) break;
      const triggered = isStopLoss
        ? long
          ? bar.low <= level.price
          : bar.high >= level.price
        : long
          ? bar.high >= level.price
          : bar.low <= level.price;
      if (!triggered) continue;

      const closeSize = Math.min(level.size, this._size);
      this._realizedPnl +=
        (level.price - this._averageEntry) *
        closeSize *
        Trade.directionFactor(this.side);
      this._size -= closeSize;

      level.size -= closeSize;
      if (level.size === 0) {
        const idx = levels.indexOf(level);
        if (idx !== -1) levels.splice(idx, 1);
      }

      if (this._size === 0) {
        this._state = TradeState.Closed;
      }
    }
  }
}
