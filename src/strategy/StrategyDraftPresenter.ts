import { normalizeParams } from '../shared/utils/normalizeParams';
import {
  getConditionIndicatorLabel,
  getConditionIndicatorOption,
} from './ConditionIndicatorCatalog';
import type {
  ComparisonOperator,
  ConditionField,
  ConditionIndicatorId,
  ConditionSummary,
  StrategyCondition,
  StrategyDraftState,
} from './types';

export type {
  ComparisonOperator,
  ConditionField,
  ConditionIndicatorId,
  ConditionSummary,
  PriceSourceId,
  StrategyCondition,
  StrategyDraftState,
} from './types';

const CONDITION_FIELDS: ConditionField[] = ['entry', 'stopLoss', 'takeProfit'];

const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = {
  gt: '>',
  lt: '<',
};

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
    const missing = this.getMissing();
    return {
      name: this.name,
      conditions: this.conditions,
      isReady: missing.length === 0,
      missing,
      summary: this.getSummary(missing),
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
      params: this.defaultParamsFor(indicatorId),
    };
  }

  updateConditionParams(
    field: ConditionField,
    params: Record<string, number>
  ): void {
    const condition = this.conditions[field];
    if (condition.indicatorId === null) return;

    const option = getConditionIndicatorOption(condition.indicatorId);
    if (!option || option.params.length === 0) return;

    this.conditions[field] = {
      ...condition,
      params: normalizeParams(option.params, {
        ...condition.params,
        ...params,
      }),
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

  private defaultParamsFor(
    indicatorId: ConditionIndicatorId
  ): Record<string, number> {
    const option = getConditionIndicatorOption(indicatorId);
    return option ? normalizeParams(option.params, {}) : {};
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

  private getSummary(missing: string[]): ConditionSummary | null {
    if (missing.length > 0) return null;

    return {
      entry: this.formatCondition(this.conditions.entry),
      stopLoss: this.formatCondition(this.conditions.stopLoss),
      takeProfit: this.formatCondition(this.conditions.takeProfit),
    };
  }

  private formatCondition(condition: StrategyCondition): string {
    const { indicatorId, operator, value } = condition;
    if (indicatorId === null || operator === null || value === null) return '';
    return `${getConditionIndicatorLabel(indicatorId, condition.params)} ${OPERATOR_SYMBOLS[operator]} ${value}`;
  }
}
