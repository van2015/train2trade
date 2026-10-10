import { IndicatorId } from '../../shared/types/asset';

export type IndicatorError =
  | { readonly type: 'INDICATOR_NOT_FOUND'; readonly indicatorId: IndicatorId };
