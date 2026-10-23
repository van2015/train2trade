import type { IndicatorId } from '../shared/types/asset';

export type ConditionField = 'entry' | 'stopLoss' | 'takeProfit';

export type ConditionIndicatorId =
  | IndicatorId
  | 'close'
  | 'open'
  | 'high'
  | 'low';

export type ComparisonOperator = 'gt' | 'lt';

export interface StrategyCondition {
  indicatorId: ConditionIndicatorId | null;
  params: Record<string, number>;
  operator: ComparisonOperator | null;
  value: number | null;
}

export interface StrategyDraftState {
  name: string;
  conditions: Record<ConditionField, StrategyCondition>;
  isReady: boolean;
  missing: string[];
}

const CONDITION_FIELDS: ConditionField[] = ['entry', 'stopLoss', 'takeProfit'];

function emptyCondition(): StrategyCondition {
  return { indicatorId: null, params: {}, operator: null, value: null };
}

export class StrategyDraftPresenter {
  private name = '';
  private conditions: Record<ConditionField, StrategyCondition> = {
    entry: emptyCondition(),
    stopLoss: emptyCondition(),
    takeProfit: emptyCondition(),
  };

  getState(): StrategyDraftState {
    return {
      name: this.name,
      conditions: this.conditions,
      isReady: false,
      missing: this.getMissing(),
    };
  }

  setName(name: string): void {
    this.name = name;
  }

  setConditionIndicator(
    field: ConditionField,
    indicatorId: ConditionIndicatorId
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      indicatorId,
    };
  }

  setConditionOperator(
    field: ConditionField,
    operator: ComparisonOperator
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      operator,
    };
  }

  setConditionValue(field: ConditionField, value: number | null): void {
    this.conditions[field] = {
      ...this.conditions[field],
      value,
    };
  }

  private getMissing(): string[] {
    const missing: string[] = [];
    if (this.name.trim().length === 0) missing.push('name');

    for (const field of CONDITION_FIELDS) {
      const condition = this.conditions[field];
      if (condition.indicatorId === null) missing.push(`${field}.indicator`);
      if (condition.operator === null) missing.push(`${field}.operator`);
      if (condition.value === null) missing.push(`${field}.value`);
    }

    return missing;
  }
}
