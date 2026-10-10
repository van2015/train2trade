export type BrokerError =
  | { readonly type: 'STOP_REQUIRED' }
  | { readonly type: 'STOP_SAME_AS_ENTRY' }
  | { readonly type: 'PRICE_NOT_TICK_ALIGNED' }
  | { readonly type: 'SIZE_VIOLATES_LOTS' };
