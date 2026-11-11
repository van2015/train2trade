import { Timeframe } from '@/domain/candles/timeframe'

/** Máximo de velas que pediremos de una vez a la API. */
export const MAX_CANDLES = 1000

/** Velas que cubre el rango para un timeframe (máx. `MAX_CANDLES`); rango invertido → error. */
export function candleLimitForRange(startMs: number, endMs: number, timeframe: Timeframe): number {
  if (!(startMs < endMs)) {
    throw new RangeError('Rango de fechas inválido: start debe ser estrictamente menor que end')
  }
  const limit = Math.floor((endMs - startMs) / timeframe.ms) + 1
  return Math.min(limit, MAX_CANDLES)
}
