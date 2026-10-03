export type BrokerError =
  | { readonly type: 'STOP_REQUIRED' }
  | { readonly type: 'STOP_SAME_AS_ENTRY' };
