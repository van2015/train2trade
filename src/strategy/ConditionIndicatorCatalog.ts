import { INDICATOR_DEFINITIONS } from '../chart/indicators/IndicatorService';
import type { IndicatorParamSpec } from '../shared/types/asset';
import type { ConditionIndicatorId, PriceSourceId } from './types';

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

const OPTIONS: ConditionIndicatorOption[] = [
  ...PRICE_SOURCE_OPTIONS,
  ...INDICATOR_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    params: definition.params,
  })),
];

export function getConditionIndicatorOptions(): ConditionIndicatorOption[] {
  return OPTIONS;
}

export function getConditionIndicatorOption(
  id: ConditionIndicatorId
): ConditionIndicatorOption | undefined {
  return OPTIONS.find((option) => option.id === id);
}

export function getConditionIndicatorLabel(
  id: ConditionIndicatorId,
  params: Record<string, number>
): string {
  const option = getConditionIndicatorOption(id);
  if (!option) return id;

  const values = option.params.map((spec) => params[spec.key]);
  return values.length > 0
    ? `${option.label}(${values.join(', ')})`
    : option.label;
}
