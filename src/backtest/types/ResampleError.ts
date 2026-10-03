import { Timeframe } from '../timeframe/Timeframe';

export type ResampleError = {
  readonly type: 'INVALID_TIMEFRAME_COMBINATION';
  readonly source: Timeframe;
  readonly target: Timeframe;
};
