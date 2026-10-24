import type { IndicatorId } from '../shared/types/asset';

export type ConditionField = 'entry' | 'stopLoss' | 'takeProfit';

export type PriceSourceId = 'close' | 'open' | 'high' | 'low';

export type ConditionIndicatorId = IndicatorId | PriceSourceId;

export type ComparisonOperator = 'gt' | 'lt' | 'crossAbove' | 'crossBelow';

export type ConditionRightSide = 'value' | 'indicator';

export type ConditionConnector = 'and' | 'or';

export type ConditionSummary = Record<ConditionField, string>;

export interface StrategyCondition {
  draftId: string;
  negated: boolean;
  indicatorId: ConditionIndicatorId | null;
  params: Record<string, number>;
  operator: ComparisonOperator | null;
  rightSide: ConditionRightSide;
  value: number | null;
  rightIndicatorId: ConditionIndicatorId | null;
  rightParams: Record<string, number>;
}

export interface StrategyConditionGroup {
  connector: ConditionConnector;
  conditions: StrategyCondition[];
}

export interface StrategyDraftState {
  name: string;
  conditions: Record<ConditionField, StrategyConditionGroup>;
  isReady: boolean;
  missing: string[];
  summary: ConditionSummary | null;
}
