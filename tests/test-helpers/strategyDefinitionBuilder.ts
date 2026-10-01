import {
  StrategyContext,
  StrategyDefinition,
  StrategyParameterSpec,
  TradeSpec,
} from '../../src/backtest/types/backtest';
import { Timeframe } from '../../src/backtest/timeframe/Timeframe';

export class StrategyDefinitionBuilder {
  private config: StrategyDefinition = {
    id: 'strategy',
    label: 'Strategy',
    timeframe: '1m',
    params: [],
    onBar: () => [],
  };

  id(id: string): this {
    this.config.id = id;
    return this;
  }

  label(label: string): this {
    this.config.label = label;
    return this;
  }

  timeframe(timeframe: Timeframe): this {
    this.config.timeframe = timeframe;
    return this;
  }

  param(spec: StrategyParameterSpec): this {
    this.config.params.push(spec);
    return this;
  }

  onBar(handler: (ctx: StrategyContext, params: Record<string, number>) => TradeSpec[]): this {
    this.config.onBar = handler;
    return this;
  }

  build(): StrategyDefinition {
    return { ...this.config, params: this.config.params.map(spec => ({ ...spec })) };
  }
}
