import type {
  ComparisonOperator,
  ConditionField,
  PriceSourceId,
} from '../../src/strategy/StrategyDraftPresenter';
import { StrategyDraftPresenter } from '../../src/strategy/StrategyDraftPresenter';

export class StrategyDraftBuilder {
  private readonly presenter = new StrategyDraftPresenter();

  named(name: string): this {
    this.presenter.setName(name);
    return this;
  }

  withCondition(
    field: ConditionField,
    indicator: PriceSourceId,
    operator: ComparisonOperator,
    value: number,
    index = 0
  ): this {
    while (this.presenter.getConditions()[field].conditions.length <= index) {
      this.presenter.addCondition(field);
    }
    this.presenter.setConditionIndicator(field, indicator, index);
    this.presenter.setConditionOperator(field, operator, index);
    this.presenter.setConditionValue(field, value, index);
    return this;
  }

  withIndicatorCondition(
    field: ConditionField,
    left: PriceSourceId,
    operator: ComparisonOperator,
    right: PriceSourceId
  ): this {
    this.presenter.setConditionIndicator(field, left);
    this.presenter.setConditionOperator(field, operator);
    this.presenter.setConditionRightSide(field, 'indicator');
    this.presenter.setConditionRightIndicator(field, right);
    return this;
  }

  withDefaultConditions(): this {
    return this.withCondition('entry', 'close', 'gt', 100)
      .withCondition('stopLoss', 'low', 'lt', 90)
      .withCondition('takeProfit', 'high', 'gt', 120);
  }

  withOpening(
    direction: 'long' | 'short' = 'long',
    risk: number = 1,
    trigger: ConditionField = 'entry'
  ): this {
    this.presenter.setDirection(direction);
    this.presenter.setRisk(risk);
    this.presenter.setTrigger(trigger);
    return this;
  }

  build(): StrategyDraftPresenter {
    return this.presenter;
  }
}

export function aStrategyDraft(): StrategyDraftBuilder {
  return new StrategyDraftBuilder();
}
