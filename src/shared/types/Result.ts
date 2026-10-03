export type Result<T, E> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: E };
