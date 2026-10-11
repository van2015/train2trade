import {
  LongOrder,
  type Order,
  ShortOrder,
} from '../../src/engine/TradingEngine';

export class PositionBuilder {
  private _side: 'long' | 'short' = 'long';
  private _price: number = 100;
  private _size: number = 1;
  private _state: 'pending' | 'open' | 'closed' = 'open';
  private _stopLoss?: number;
  private _takeProfit?: number;
  private _exitLevels?: {
    kind: 'tp' | 'sl';
    price: number;
    sizePercent: number;
  }[];
  private _entryFee?: number;
  private _feeBasis?: number;
  private _exitPrice?: number;
  private _pnl?: number;

  side(s: 'long' | 'short'): this {
    this._side = s;
    return this;
  }

  long(): this {
    return this.side('long');
  }

  short(): this {
    return this.side('short');
  }

  entryPrice(price: number): this {
    this._price = price;
    return this;
  }

  size(size: number): this {
    this._size = size;
    return this;
  }

  state(s: 'pending' | 'open' | 'closed'): this {
    this._state = s;
    return this;
  }

  exitPrice(price: number): this {
    this._exitPrice = price;
    return this;
  }

  stopLoss(price: number): this {
    this._stopLoss = price;
    return this;
  }

  takeProfit(price: number): this {
    this._takeProfit = price;
    return this;
  }

  build(finalState?: 'pending' | 'open' | 'closed'): Order {
    const s = finalState ?? this._state;
    const opts = {
      stopLoss: this._stopLoss,
      takeProfit: this._takeProfit,
      exitLevels: this._exitLevels,
      entryFee: this._entryFee,
      feeBasis: this._feeBasis,
      exitPrice: this._exitPrice,
      pnl: this._pnl,
    };
    return this._side === 'long'
      ? new LongOrder(s, this._price, this._size, opts)
      : new ShortOrder(s, this._price, this._size, opts);
  }
}
