import { IndicatorId, IndicatorInstance } from '../../src/shared/types/asset';

export class IndicatorInstanceBuilder {
  private config: IndicatorInstance = {
    key: 'indicator-1',
    indicatorId: 'sma',
    params: {},
  };

  id(indicatorId: IndicatorId): this {
    this.config.indicatorId = indicatorId;
    return this;
  }

  key(key: string): this {
    this.config.key = key;
    return this;
  }

  params(params: Record<string, number>): this {
    this.config.params = params;
    return this;
  }

  build(): IndicatorInstance {
    return { ...this.config, params: { ...this.config.params } };
  }
}
