/** Mensaje legible de un error desconocido: `Error` → su mensaje; el resto → `String(error)`. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
