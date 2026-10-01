import { TradePredicate, TradeSpec } from '../../src/backtest/types/backtest';

export class TradeBuilder {
  private spec: TradeSpec = {
    side: 'long',
    order: { type: 'market' },
    risk: { fraction: 0.01 },
    rules: [],
  };

  private sideSpecified = false;
  private orderSpecified = false;

  long(): this {
    this.spec.side = 'long';
    this.sideSpecified = true;
    return this;
  }

  short(): this {
    this.spec.side = 'short';
    this.sideSpecified = true;
    return this;
  }

  market(): this {
    this.spec.order = { type: 'market' };
    this.orderSpecified = true;
    return this;
  }

  limit(price: number): this {
    this.spec.order = { type: 'limit', price };
    this.orderSpecified = true;
    return this;
  }

  stop(price: number): this {
    this.spec.order = { type: 'stop', price };
    this.orderSpecified = true;
    return this;
  }

  risk(fraction: number): this {
    this.spec.risk = { fraction };
    return this;
  }

  stopLoss(price: number): this {
    this.spec.stopLoss = price;
    return this;
  }

  takeProfit(price: number): this {
    this.spec.takeProfit = price;
    return this;
  }

  tag(tag: string): this {
    this.spec.tag = tag;
    return this;
  }

  trailingStop(distance: number): this {
    this.spec.rules.push({ kind: 'trailingStop', distance });
    return this;
  }

  breakEvenAtR(rMultiple: number): this {
    this.spec.rules.push({ kind: 'breakEvenAtR', rMultiple });
    return this;
  }

  partialTakeProfit(portion: number, rMultiple: number): this {
    this.spec.rules.push({ kind: 'partialTakeProfit', portion, rMultiple });
    return this;
  }

  closeWhen(predicate: TradePredicate): this {
    this.spec.rules.push({ kind: 'closeWhen', predicate });
    return this;
  }

  build(): TradeSpec {
    if (!this.sideSpecified) {
      throw new Error('Specify the side with long() or short()');
    }
    if (!this.orderSpecified) {
      throw new Error('Specify an order type with market(), limit(price) or stop(price)');
    }
    return { ...this.spec, risk: { ...this.spec.risk }, rules: [...this.spec.rules] };
  }
}
