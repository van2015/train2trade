import { newId } from '../shared/utils/newId';
import { normalizeParams } from '../shared/utils/normalizeParams';
import {
  getConditionIndicatorLabel,
  getConditionIndicatorOption,
} from './ConditionIndicatorCatalog';
import type {
  ComparisonOperator,
  ConditionConnector,
  ConditionField,
  ConditionIndicatorId,
  ConditionRightSide,
  ConditionSummary,
  StrategyCondition,
  StrategyConditionGroup,
} from './types';

export type {
  ComparisonOperator,
  ConditionConnector,
  ConditionField,
  ConditionIndicatorId,
  ConditionRightSide,
  ConditionSummary,
  PriceSourceId,
  StrategyCondition,
  StrategyConditionGroup,
} from './types';

export class StrategyDraftPresenter {
  static readonly CONDITION_FIELDS: ConditionField[] = [
    'entry',
    'stopLoss',
    'takeProfit',
  ];

  static readonly FIELD_LABELS: Record<ConditionField, string> = {
    entry: 'Entry',
    stopLoss: 'Stop Loss',
    takeProfit: 'Take Profit',
  };

  static readonly OPERATORS: { value: ComparisonOperator; label: string }[] = [
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'crossAbove', label: 'crosses above' },
    { value: 'crossBelow', label: 'crosses below' },
  ];

  static readonly OPERATOR_SYMBOLS: Record<ComparisonOperator, string> =
    Object.fromEntries(
      StrategyDraftPresenter.OPERATORS.map((operator) => [
        operator.value,
        operator.label,
      ])
    ) as Record<ComparisonOperator, string>;

  private name: string;
  private direction: 'long' | 'short' | null;
  private risk: number | null;
  private trigger: ConditionField | null;
  private orderType: 'market' | 'limit';
  private limitIndicatorId: ConditionIndicatorId | null;
  private limitParams: Record<string, number>;
  private conditions: Record<ConditionField, StrategyConditionGroup>;

  constructor() {
    this.name = '';
    this.direction = null;
    this.risk = null;
    this.trigger = null;
    this.orderType = 'market';
    this.limitIndicatorId = null;
    this.limitParams = {};
    this.conditions = {
      entry: this.emptyGroup(),
      stopLoss: this.emptyGroup(),
      takeProfit: this.emptyGroup(),
    };
  }

  getName(): string {
    return this.name;
  }

  getConditions(): Record<ConditionField, StrategyConditionGroup> {
    return this.conditions;
  }

  getDirection(): 'long' | 'short' | null {
    return this.direction;
  }

  getRisk(): number | null {
    return this.risk;
  }

  getOrderType(): 'market' | 'limit' {
    return this.orderType;
  }

  getLimitIndicator(): ConditionIndicatorId | null {
    return this.limitIndicatorId;
  }

  getLimitParams(): Record<string, number> {
    return this.limitParams;
  }

  isReady(): boolean {
    return this.getMissing().length === 0;
  }

  getMissing(): string[] {
    const missing: string[] = [];
    if (this.name.trim().length === 0) missing.push('name');
    if (this.direction === null) missing.push('direction');
    if (this.risk === null || !Number.isFinite(this.risk) || this.risk <= 0) {
      missing.push('risk');
    }
    if (this.trigger === null) missing.push('trigger');
    if (this.orderType === 'limit' && this.limitIndicatorId === null) {
      missing.push('limitIndicator');
    }

    for (const field of StrategyDraftPresenter.CONDITION_FIELDS) {
      const group = this.conditions[field];
      if (group.conditions.length === 0) {
        missing.push(`${field}.conditions`);
        continue;
      }

      group.conditions.forEach((condition, index) => {
        const prefix = `${field}.${index + 1}`;
        if (condition.indicatorId === null) {
          missing.push(`${prefix}.indicator`);
        }
        if (condition.operator === null) {
          missing.push(`${prefix}.operator`);
        }

        if (condition.rightSide === 'indicator') {
          if (condition.rightIndicatorId === null)
            missing.push(`${prefix}.rightIndicator`);
        } else if (condition.value === null) {
          missing.push(`${prefix}.value`);
        }
      });
    }

    return missing;
  }

  getSummary(): ConditionSummary | null {
    return this.summaryFor(this.getMissing());
  }

  getTrigger(): ConditionField | null {
    return this.trigger;
  }

  setName(name: string): void {
    this.name = name;
  }

  setDirection(direction: 'long' | 'short' | null): void {
    this.direction = direction;
  }

  setRisk(risk: number | null): void {
    this.risk = risk;
  }

  setTrigger(trigger: ConditionField | null): void {
    this.trigger = trigger;
  }

  setOrderType(orderType: 'market' | 'limit'): void {
    this.orderType = orderType;
  }

  setLimitIndicator(indicatorId: ConditionIndicatorId): void {
    this.limitIndicatorId = indicatorId;
    this.limitParams = this.defaultParamsFor(indicatorId);
  }

  updateLimitParams(params: Record<string, number>): void {
    const next = this.normalizeConditionParams(
      this.limitIndicatorId,
      this.limitParams,
      params
    );
    if (next === null) return;

    this.limitParams = next;
  }

  addCondition(field: ConditionField): void {
    this.conditions[field] = {
      ...this.conditions[field],
      conditions: [...this.conditions[field].conditions, this.emptyCondition()],
    };
  }

  removeCondition(field: ConditionField, index: number): void {
    this.conditions[field] = {
      ...this.conditions[field],
      conditions: this.conditions[field].conditions.filter(
        (_, position) => position !== index
      ),
    };
  }

  setConditionConnector(
    field: ConditionField,
    connector: ConditionConnector
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      connector,
    };
  }

  setConditionIndicator(
    field: ConditionField,
    indicatorId: ConditionIndicatorId,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, {
      ...condition,
      indicatorId,
      params: this.defaultParamsFor(indicatorId),
    });
  }

  updateConditionParams(
    field: ConditionField,
    params: Record<string, number>,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    const next = this.normalizeConditionParams(
      condition.indicatorId,
      condition.params,
      params
    );
    if (next === null) return;

    this.setConditionAt(field, index, { ...condition, params: next });
  }

  setConditionOperator(
    field: ConditionField,
    operator: ComparisonOperator,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, { ...condition, operator });
  }

  setConditionRightSide(
    field: ConditionField,
    rightSide: ConditionRightSide,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, { ...condition, rightSide });
  }

  setConditionRightIndicator(
    field: ConditionField,
    indicatorId: ConditionIndicatorId,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, {
      ...condition,
      rightIndicatorId: indicatorId,
      rightParams: this.defaultParamsFor(indicatorId),
    });
  }

  updateConditionRightParams(
    field: ConditionField,
    params: Record<string, number>,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    const next = this.normalizeConditionParams(
      condition.rightIndicatorId,
      condition.rightParams,
      params
    );
    if (next === null) return;

    this.setConditionAt(field, index, { ...condition, rightParams: next });
  }

  setConditionValue(
    field: ConditionField,
    value: number | null,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, { ...condition, value });
  }

  setConditionNegated(
    field: ConditionField,
    negated: boolean,
    index = 0
  ): void {
    const condition = this.conditionAt(field, index);
    if (!condition) return;

    this.setConditionAt(field, index, { ...condition, negated });
  }

  private emptyCondition(): StrategyCondition {
    return {
      draftId: newId('condition'),
      negated: false,
      indicatorId: null,
      params: {},
      operator: null,
      rightSide: 'value',
      value: null,
      rightIndicatorId: null,
      rightParams: {},
    };
  }

  private emptyGroup(): StrategyConditionGroup {
    return {
      connector: 'and',
      conditions: [this.emptyCondition()],
    };
  }

  private conditionAt(
    field: ConditionField,
    index: number
  ): StrategyCondition | undefined {
    return this.conditions[field].conditions[index];
  }

  private setConditionAt(
    field: ConditionField,
    index: number,
    condition: StrategyCondition
  ): void {
    this.conditions[field] = {
      ...this.conditions[field],
      conditions: this.conditions[field].conditions.map((current, position) =>
        position === index ? condition : current
      ),
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

  private summaryFor(missing: string[]): ConditionSummary | null {
    if (
      this.direction === null ||
      this.risk === null ||
      this.trigger === null
    ) {
      return null;
    }
    const opening = this.formatOpening();
    if (opening === null) return null;
    if (missing.length > 0) return null;

    return {
      direction: this.direction === 'long' ? 'Long' : 'Short',
      opening,
      risk: `${this.risk}%`,
      trigger: StrategyDraftPresenter.FIELD_LABELS[this.trigger],
      entry: this.formatGroup(this.conditions.entry),
      stopLoss: this.formatGroup(this.conditions.stopLoss),
      takeProfit: this.formatGroup(this.conditions.takeProfit),
    };
  }

  private formatOpening(): string | null {
    if (this.orderType === 'market') return 'Market';
    if (this.limitIndicatorId === null) return null;
    return `Limit ${getConditionIndicatorLabel(this.limitIndicatorId, this.limitParams)}`;
  }

  private formatGroup(group: StrategyConditionGroup): string {
    const connector = group.connector === 'and' ? 'AND' : 'OR';
    return group.conditions
      .map((condition) => this.formatCondition(condition))
      .join(` ${connector} `);
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
    const formatted = `${getConditionIndicatorLabel(indicatorId, condition.params)} ${StrategyDraftPresenter.OPERATOR_SYMBOLS[operator]} ${right}`;
    return condition.negated ? `NOT (${formatted})` : formatted;
  }
}
