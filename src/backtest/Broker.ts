import {
  OrderSide,
  OrderValidation,
  OrderValidationInput,
  PlatformConfig,
} from '../types/backtest';

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const steps = Math.floor(value / step + 1e-9);
  return Number((steps * step).toFixed(10));
}

export class Broker {
  private readonly config: PlatformConfig;
  private _balance: number;
  private _margin = 0;

  constructor(config: PlatformConfig, initialBalance: number) {
    this.config = config;
    this._balance = initialBalance;
  }

  get platform(): PlatformConfig {
    return this.config;
  }

  get balance(): number {
    return this._balance;
  }

  get margin(): number {
    return this._margin;
  }

  sizeFromRisk(
    riskFraction: number,
    entry: number,
    stop: number | undefined,
    equity: number
  ): number {
    if (stop === undefined || !Number.isFinite(stop)) {
      throw new Error('A stop is required for risk-based sizing');
    }
    const distance = Math.abs(entry - stop);
    if (distance <= 0) {
      throw new Error('Stop must differ from entry to size a position');
    }
    const perLotRisk = distance * this.config.contractSize;
    const rawLots = (riskFraction * equity) / perLotRisk;
    const lots = roundToStep(rawLots, this.config.lotStep);
    if (lots < this.config.minLot) return 0;
    return lots;
  }

  isTickAligned(price: number): boolean {
    if (this.config.tickSize <= 0) return true;
    const steps = price / this.config.tickSize;
    return Math.abs(steps - Math.round(steps)) < 1e-8;
  }

  alignToTick(price: number): number {
    if (this.config.tickSize <= 0) return price;
    return Number((Math.round(price / this.config.tickSize) * this.config.tickSize).toFixed(10));
  }

  isSizeValid(size: number): boolean {
    if (size < this.config.minLot) return false;
    const steps = size / this.config.lotStep;
    return Math.abs(steps - Math.round(steps)) < 1e-8;
  }

  alignSize(size: number): number {
    return roundToStep(size, this.config.lotStep);
  }

  validateOrder(input: OrderValidationInput): OrderValidation {
    if (input.price !== undefined && !this.isTickAligned(input.price)) {
      return { valid: false, reason: 'Price is not aligned to the tick size' };
    }
    if (!this.isSizeValid(input.size)) {
      return { valid: false, reason: 'Size violates lot step or minimum' };
    }
    return { valid: true };
  }

  fillPrice(side: OrderSide, referencePrice: number, withSlippage = true): number {
    const halfSpread = this.config.spread / 2;
    const slippage = withSlippage ? this.config.slippage : 0;
    const adjustment = halfSpread + slippage;
    return side === 'buy' ? referencePrice + adjustment : referencePrice - adjustment;
  }

  commission(size: number): number {
    return size * this.config.commissionPerLot;
  }

  marginRequired(size: number, price: number): number {
    return (size * this.config.contractSize * price) / this.config.leverage;
  }

  addMargin(size: number, price: number): void {
    this._margin += this.marginRequired(size, price);
  }

  releaseMargin(size: number, price: number): void {
    this._margin = Math.max(0, this._margin - this.marginRequired(size, price));
  }

  applyRealizedPnl(pnl: number): void {
    this._balance += pnl;
  }

  isStopOut(equity: number): boolean {
    return this._margin > 0 && equity <= this._margin * this.config.stopOutLevel;
  }
}
