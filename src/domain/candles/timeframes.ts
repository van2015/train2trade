export const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const

export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number]

/** Máximo de velas que pediremos de una vez a la API. */
export const MAX_CANDLES = 1000

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

export function isSupportedTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value)
}

export function resolveTimeframe(value: string): Timeframe {
  if (!isSupportedTimeframe(value)) {
    throw new Error(
      `Timeframe no soportado: "${value}". Usa uno de ${SUPPORTED_TIMEFRAMES.join(', ')}`,
    )
  }
  return value
}

export function timeframeToMs(timeframe: Timeframe): number {
  const ms = TIMEFRAME_MS[timeframe]
  if (ms === undefined) {
    throw new Error(`Timeframe no soportado: "${timeframe}"`)
  }
  return ms
}

/**
 * Número de velas que cubre un rango de fechas para un timeframe,
 * limitado a MAX_CANDLES. Lanza si el rango es invertido.
 */
export function candleLimitForRange(startMs: number, endMs: number, timeframe: Timeframe): number {
  if (!(startMs < endMs)) {
    throw new RangeError('Rango de fechas inválido: start debe ser estrictamente menor que end')
  }
  const limit = Math.floor((endMs - startMs) / timeframeToMs(timeframe)) + 1
  return Math.min(limit, MAX_CANDLES)
}
