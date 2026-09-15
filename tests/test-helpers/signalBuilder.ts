import { OpenSignal, Signal } from '../../src/types/backtest';

export class SignalBuilder {
  private signal: Signal;
  private orderSpecified = false;

  private constructor(signal: Signal) {
    this.signal = signal;
  }

  static long(): SignalBuilder {
    return new SignalBuilder({
      kind: 'open',
      side: 'long',
      order: { type: 'market' },
      risk: { fraction: 0.01 },
    });
  }

  static short(): SignalBuilder {
    return new SignalBuilder({
      kind: 'open',
      side: 'short',
      order: { type: 'market' },
      risk: { fraction: 0.01 },
    });
  }

  static close(positionId: string): SignalBuilder {
    return new SignalBuilder({ kind: 'close', positionId });
  }

  static moveStop(positionId: string, price: number): SignalBuilder {
    return new SignalBuilder({ kind: 'moveStop', positionId, price });
  }

  static moveTarget(positionId: string, price: number): SignalBuilder {
    return new SignalBuilder({ kind: 'moveTarget', positionId, price });
  }

  market(): this {
    this.asOpen().order = { type: 'market' };
    this.orderSpecified = true;
    return this;
  }

  limit(price: number): this {
    this.asOpen().order = { type: 'limit', price };
    this.orderSpecified = true;
    return this;
  }

  stop(price: number): this {
    this.asOpen().order = { type: 'stop', price };
    this.orderSpecified = true;
    return this;
  }

  risk(fraction: number): this {
    this.asOpen().risk = { fraction };
    return this;
  }

  stopLoss(price: number): this {
    this.asOpen().stopLoss = price;
    return this;
  }

  takeProfit(price: number): this {
    this.asOpen().takeProfit = price;
    return this;
  }

  portion(portion: number): this {
    const signal = this.signal;
    if (signal.kind !== 'close') throw new Error('portion is only valid for close signals');
    signal.portion = portion;
    return this;
  }

  build(): Signal {
    if (this.signal.kind === 'open' && !this.orderSpecified) {
      throw new Error('Specify an order type with market(), limit(price) or stop(price)');
    }
    return this.signal;
  }

  private asOpen(): OpenSignal {
    if (this.signal.kind !== 'open') {
      throw new Error('This method is only valid for open signals');
    }
    return this.signal;
  }
}
