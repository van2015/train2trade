import type { Result } from '../shared/types/Result';

export type EngineError =
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INVALID_STOP_LOSS'
  | 'INVALID_TAKE_PROFIT'
  | 'DUPLICATE_EXIT_LEVEL'
  | 'POSITION_NOT_OPEN';

export type ExitLevelKind = 'tp' | 'sl';

export interface ExitLevel {
  kind: ExitLevelKind;
  price: number;
  sizePercent: number;
}

export type OrderState = 'pending' | 'open' | 'closed';

export type { Result };
