import { Timeframe } from '@/domain/candles/timeframe'

/** Máximo de velas que pediremos de una vez a la API. */
export const MAX_CANDLES = 1000

/**
 * Número de velas que cubre un rango de fechas para un timeframe,
 * limitado a MAX_CANDLES. Lanza si el rango es invertido.
 */
export function candleLimitForRange(startMs: number, endMs: number, timeframe: Timeframe): number {
  if (!(startMs < endMs)) {
    throw new RangeError('Rango de fechas inválido: start debe ser estrictamente menor que end')
  }
  const limit = Math.floor((endMs - startMs) / timeframe.ms) + 1
  return Math.min(limit, MAX_CANDLES)
}
