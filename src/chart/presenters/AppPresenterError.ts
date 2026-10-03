export type AppPresenterError =
  | { readonly type: 'VALIDATION_FAILED'; readonly message: string }
  | { readonly type: 'IMPORT_FAILED'; readonly message: string }
  | { readonly type: 'DELETE_FAILED'; readonly message: string }
  | { readonly type: 'LOAD_FAILED'; readonly message: string };
