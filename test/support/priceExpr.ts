import { PriceExpr, PriceSeriesRef, series } from '@/domain/strategies/priceExpr'

/** Constructor binario para fixtures: `bin('+', 'fast', 'slow')` (los strings son hojas de serie). */
export function bin(
  op: '+' | '-' | '*' | '/',
  left: PriceSeriesRef,
  right: PriceSeriesRef,
): PriceExpr {
  return {
    kind: 'binary',
    op,
    left: typeof left === 'string' ? series(left) : left,
    right: typeof right === 'string' ? series(right) : right,
  }
}
