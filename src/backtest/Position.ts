import { Fill, PositionState, PositionView, Side } from '../types/backtest';

function directionFactor(side: Side): number {
  return side === 'long' ? 1 : -1;
}

export class Position {
  readonly id: string;
  readonly side: Side;

  private _state: PositionState = 'pending';
  private _size = 0;
  private _averageEntry = 0;
  private _stopLoss?: number;
  private _takeProfit?: number;
  private _initialStopLoss?: number;
  private _initialAverageEntry?: number;
  private _initialSize?: number;
  private _realizedPnl = 0;
  private readonly _fills: Fill[] = [];

  constructor(id: string, side: Side) {
    this.id = id;
    this.side = side;
  }

  get state(): PositionState {
    return this._state;
  }

  get size(): number {
    return this._size;
  }

  get averageEntry(): number {
    return this._averageEntry;
  }

  get stopLoss(): number | undefined {
    return this._stopLoss;
  }

  get takeProfit(): number | undefined {
    return this._takeProfit;
  }

  get initialStopLoss(): number | undefined {
    return this._initialStopLoss;
  }

  get realizedPnl(): number {
    return this._realizedPnl;
  }

  get fills(): readonly Fill[] {
    return this._fills;
  }

  get rMultiple(): number | undefined {
    if (this._initialStopLoss === undefined || this._initialAverageEntry === undefined) {
      return undefined;
    }
    if (this._initialSize === undefined || this._initialSize === 0) {
      return undefined;
    }
    const risk = Math.abs(this._initialAverageEntry - this._initialStopLoss) * this._initialSize;
    if (risk === 0) return undefined;
    return this._realizedPnl / risk;
  }

  addFill(size: number, price: number, time?: number): void {
    this.assertNotClosed();
    if (size <= 0) throw new Error('Fill size must be positive');

    const isFirstFill = this._fills.length === 0;
    this._fills.push({ size, price, time });

    const newSize = this._size + size;
    this._averageEntry =
      newSize === 0 ? price : (this._size * this._averageEntry + size * price) / newSize;
    this._size = newSize;

    if (isFirstFill) {
      this._initialAverageEntry = this._averageEntry;
      this._initialSize = size;
      if (this._initialStopLoss === undefined && this._stopLoss !== undefined) {
        this._initialStopLoss = this._stopLoss;
      }
      this._state = 'open';
    }
  }

  reduce(size: number, price: number): boolean {
    this.assertNotClosed();
    if (size <= 0 || size > this._size) return false;

    this._realizedPnl += this.pnlFor(size, price);
    this._size -= size;
    if (this._size === 0) {
      this._state = 'closed';
    }
    return true;
  }

  setStopLoss(price: number): void {
    this.assertNotClosed();
    this._stopLoss = price;
    if (this._initialStopLoss === undefined) {
      this._initialStopLoss = price;
    }
  }

  setTakeProfit(price: number): void {
    this.assertNotClosed();
    this._takeProfit = price;
  }

  close(price: number): void {
    this.assertNotClosed();
    if (this._size > 0) {
      this._realizedPnl += this.pnlFor(this._size, price);
    }
    this._size = 0;
    this._state = 'closed';
  }

  toView(): PositionView {
    return {
      id: this.id,
      side: this.side,
      state: this._state,
      size: this._size,
      averageEntry: this._averageEntry,
      stopLoss: this._stopLoss,
      takeProfit: this._takeProfit,
      realizedPnl: this._realizedPnl,
      rMultiple: this.rMultiple,
    };
  }

  private pnlFor(size: number, price: number): number {
    return (price - this._averageEntry) * size * directionFactor(this.side);
  }

  private assertNotClosed(): void {
    if (this._state === 'closed') {
      throw new Error(`Position ${this.id} is closed and cannot be modified`);
    }
  }
}
