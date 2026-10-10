import type { Result } from '../../src/shared/types/Result';

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.success) {
    throw new Error(
      `Expected success but got error: ${JSON.stringify(result.error)}`
    );
  }
  return result.value;
}
