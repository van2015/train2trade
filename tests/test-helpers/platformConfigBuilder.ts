import { PlatformConfig } from '../../src/shared/types/backtest';

export class PlatformConfigBuilder {
  private config: PlatformConfig = {
    contractSize: 1,
    minLot: 0.01,
    lotStep: 0.01,
    tickSize: 0.01,
    leverage: 100,
    commissionPerLot: 0,
    spread: 0,
    slippage: 0,
    stopOutLevel: 0,
  };

  static default(): PlatformConfigBuilder {
    return new PlatformConfigBuilder();
  }

  withContractSize(contractSize: number): this {
    this.config.contractSize = contractSize;
    return this;
  }

  withMinLot(minLot: number): this {
    this.config.minLot = minLot;
    return this;
  }

  withLotStep(lotStep: number): this {
    this.config.lotStep = lotStep;
    return this;
  }

  withTickSize(tickSize: number): this {
    this.config.tickSize = tickSize;
    return this;
  }

  withLeverage(leverage: number): this {
    this.config.leverage = leverage;
    return this;
  }

  withCommissionPerLot(commissionPerLot: number): this {
    this.config.commissionPerLot = commissionPerLot;
    return this;
  }

  withSpread(spread: number): this {
    this.config.spread = spread;
    return this;
  }

  withSlippage(slippage: number): this {
    this.config.slippage = slippage;
    return this;
  }

  withStopOutLevel(stopOutLevel: number): this {
    this.config.stopOutLevel = stopOutLevel;
    return this;
  }

  build(): PlatformConfig {
    return { ...this.config };
  }
}
