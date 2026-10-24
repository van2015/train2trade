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
