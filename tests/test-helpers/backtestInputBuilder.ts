import { PriceData } from '../../src/types/asset';
import { BacktestInput, PlatformConfig } from '../../src/types/backtest';
import { Timeframe } from '../../src/timeframe/Timeframe';

export class BacktestInputBuilder {
  private config: Partial<BacktestInput> = {};

  data(dataset: PriceData[]): this {
    this.config.dataset = dataset;
    return this;
  }

  strategy(strategyId: string): this {
    this.config.strategyId = strategyId;
    return this;
  }

  params(params: Record<string, number>): this {
    this.config.params = params;
    return this;
  }

  platform(platform: PlatformConfig): this {
    this.config.platform = platform;
    return this;
  }

  initialBalance(initialBalance: number): this {
    this.config.initialBalance = initialBalance;
    return this;
  }

  strategyTimeframe(strategyTimeframe: Timeframe): this {
    this.config.strategyTimeframe = strategyTimeframe;
    return this;
  }

  build(): BacktestInput {
    const { dataset, strategyId, platform } = this.config;
    if (dataset === undefined || dataset.length === 0) throw new Error('dataset is required');
    if (strategyId === undefined || strategyId === '') throw new Error('strategy is required');
    if (platform === undefined) throw new Error('platform is required');

    return {
      dataset,
      strategyId,
      params: this.config.params,
      platform,
      initialBalance: this.config.initialBalance ?? 10000,
      strategyTimeframe: this.config.strategyTimeframe,
    };
  }
}
