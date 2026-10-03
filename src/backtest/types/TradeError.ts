export type TradeError =
  | { readonly type: 'MARK_PRICE_NOT_SET' }
  | { readonly type: 'TRADE_ALREADY_OPEN'; readonly id: string }
  | { readonly type: 'TRADE_NOT_OPEN'; readonly id: string }
  | { readonly type: 'INVALID_SIZE'; readonly size: number }
  | { readonly type: 'INVALID_STOP_LOSS_SIZE'; readonly size: number }
  | { readonly type: 'INVALID_TAKE_PROFIT_SIZE'; readonly size: number }
  | { readonly type: 'INVALID_INDEX'; readonly index: number; readonly maxIndex: number }
  | {
      readonly type: 'CLOSE_SIZE_EXCEEDS_POSITION';
      readonly requested: number;
      readonly available: number;
    }
  | { readonly type: 'AMBIGUOUS_CANDLE'; readonly id: string }
  | { readonly type: 'TRADE_CLOSED'; readonly id: string };
