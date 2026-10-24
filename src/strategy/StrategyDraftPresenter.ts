import {
  getDefinition,
  normalizeParams,
} from '../chart/indicators/IndicatorService';
import type { IndicatorId } from '../shared/types/asset';

export type ConditionField = 'entry' | 'stopLoss' | 'takeProfit';

export type PriceSourceId = 'close' | 'open' | 'high' | 'low';

export type ConditionIndicatorId = IndicatorId | PriceSourceId;

export type ComparisonOperator = 'gt' | 'lt';

export type ConditionSummary = Record<ConditionField, string>;

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
  summary: ConditionSummary | null;
}

const CONDITION_FIELDS: ConditionField[] = ['entry', 'stopLoss', 'takeProfit'];

const PRICE_SOURCE_LABELS: Record<PriceSourceId, string> = {
  close: 'Close',
  open: 'Open',
  high: 'High',
  low: 'Low',
};

const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = {
  gt: '>',
  lt: '<',
};

function emptyCondition(): StrategyCondition {
  return { indicatorId: null, params: {}, operator: null, value: null };
}

function isPriceSource(id: ConditionIndicatorId): id is PriceSourceId {
  return id in PRICE_SOURCE_LABELS;
}

function indicatorLabel(
  id: ConditionIndicatorId,
  params: Record<string, number>
): string {
  if (isPriceSource(id)) return PRICE_SOURCE_LABELS[id];

  const definition = getDefinition(id);
  if (!definition) return id;
  const values = definition.params.map((spec) => params[spec.key]);
  return values.length > 0
    ? `${definition.label}(${values.join(', ')})`
    : definition.label;
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
    if (condition.indicatorId === null || isPriceSource(condition.indicatorId))
      return;

    const definition = getDefinition(condition.indicatorId);
    if (!definition) return;

    this.conditions[field] = {
      ...condition,
      params: normalizeParams(definition, { ...condition.params, ...params }),
    };
  }

  private defaultParamsFor(
    indicatorId: ConditionIndicatorId
  ): Record<string, number> {
    if (isPriceSource(indicatorId)) return {};
    const definition = getDefinition(indicatorId);
    return definition ? normalizeParams(definition, {}) : {};
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
    return `${indicatorLabel(indicatorId, condition.params)} ${OPERATOR_SYMBOLS[operator]} ${value}`;
  }
}
