import { normalizeParams } from '../shared/utils/normalizeParams';
import {
  getConditionIndicatorLabel,
  getConditionIndicatorOption,
} from './ConditionIndicatorCatalog';
import type {
  ComparisonOperator,
  ConditionField,
  ConditionIndicatorId,
  ConditionRightSide,
  ConditionSummary,
  StrategyCondition,
  StrategyDraftState,
} from './types';

export type {
  ComparisonOperator,
  ConditionField,
  ConditionIndicatorId,
  ConditionRightSide,
  ConditionSummary,
  PriceSourceId,
  StrategyCondition,
  StrategyDraftState,
} from './types';

export const CONDITION_FIELDS: ConditionField[] = [
  'entry',
  'stopLoss',
  'takeProfit',
];

export const FIELD_LABELS: Record<ConditionField, string> = {
  entry: 'Entry',
  stopLoss: 'Stop Loss',
  takeProfit: 'Take Profit',
};

export const OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'crossAbove', label: 'crosses above' },
  { value: 'crossBelow', label: 'crosses below' },
];

const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = Object.fromEntries(
  OPERATORS.map((operator) => [operator.value, operator.label])
) as Record<ComparisonOperator, string>;

function emptyCondition(): StrategyCondition {
  return {
    indicatorId: null,
    params: {},
    operator: null,
    rightSide: 'value',
    value: null,
    rightIndicatorId: null,
    rightParams: {},
  };
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
    const next = this.normalizeConditionParams(
      condition.indicatorId,
      condition.params,
      params
    );
    if (next === null) return;

    this.conditions[field] = { ...condition, params: next };
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

  setConditionRightSide(
    field: ConditionField,
    rightSide: ConditionRightSide
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      rightSide,
    };
  }

  setConditionRightIndicator(
    field: ConditionField,
    indicatorId: ConditionIndicatorId
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      rightIndicatorId: indicatorId,
      rightParams: this.defaultParamsFor(indicatorId),
    };
  }

  updateConditionRightParams(
    field: ConditionField,
    params: Record<string, number>
  ): void {
    const condition = this.conditions[field];
    const next = this.normalizeConditionParams(
      condition.rightIndicatorId,
      condition.rightParams,
      params
    );
    if (next === null) return;

    this.conditions[field] = { ...condition, rightParams: next };
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
    return this.normalizeConditionParams(indicatorId, {}, {}) ?? {};
  }

  private normalizeConditionParams(
    indicatorId: ConditionIndicatorId | null,
    current: Record<string, number>,
    changes: Record<string, number>
  ): Record<string, number> | null {
    if (indicatorId === null) return null;

    const option = getConditionIndicatorOption(indicatorId);
    if (!option || option.params.length === 0) return null;

    return normalizeParams(option.params, { ...current, ...changes });
  }

  private getMissing(): string[] {
    const missing: string[] = [];
    if (this.name.trim().length === 0) missing.push('name');

    for (const field of CONDITION_FIELDS) {
      const condition = this.conditions[field];
      if (condition.indicatorId === null) missing.push(`${field}.indicator`);
      if (condition.operator === null) missing.push(`${field}.operator`);

      if (condition.rightSide === 'indicator') {
        if (condition.rightIndicatorId === null)
          missing.push(`${field}.rightIndicator`);
      } else if (condition.value === null) {
        missing.push(`${field}.value`);
      }
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
    const { indicatorId, operator, value, rightSide, rightIndicatorId } =
      condition;
    if (indicatorId === null || operator === null) return '';

    const right =
      rightSide === 'indicator'
        ? rightIndicatorId === null
          ? null
          : getConditionIndicatorLabel(rightIndicatorId, condition.rightParams)
        : value === null
          ? null
          : String(value);

    if (right === null) return '';
    return `${getConditionIndicatorLabel(indicatorId, condition.params)} ${OPERATOR_SYMBOLS[operator]} ${right}`;
  }
}
