import { INDICATOR_DEFINITIONS } from '../chart/indicators/IndicatorService';
import type { IndicatorParamSpec } from '../shared/types/asset';
import type {
  ConditionIndicatorId,
  PriceSourceId,
} from './StrategyDraftPresenter';

export interface ConditionIndicatorOption {
  id: ConditionIndicatorId;
  label: string;
  params: IndicatorParamSpec[];
}

const PRICE_SOURCE_OPTIONS: ConditionIndicatorOption[] = (
  [
    ['close', 'Close'],
    ['open', 'Open'],
    ['high', 'High'],
    ['low', 'Low'],
  ] as [PriceSourceId, string][]
).map(([id, label]) => ({ id, label, params: [] }));

export function getConditionIndicatorOptions(): ConditionIndicatorOption[] {
  return [
    ...PRICE_SOURCE_OPTIONS,
    ...INDICATOR_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      params: definition.params,
    })),
  ];
}
