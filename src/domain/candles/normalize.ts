import { Candle, InvalidCandlesError } from './candle'

/**
 * Normaliza la respuesta cruda del exchange a Candle[]:
 * parseo e invariantes delegados en `Candle.from`, orden ascendente por tiempo,
 * sin duplicados (gana el último) y descartando las velas inválidas.
 */
export function normalizeCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) {
    throw new InvalidCandlesError('se esperaba un array de velas', raw)
  }

  const byTime = new Map<number, Candle>()

  for (const item of raw) {
    try {
      const candle = Candle.from(item)
      byTime.set(candle.time, candle)
    } catch {
      // Vela inválida: se descarta (mismo criterio que high < low o campos ausentes).
    }
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time)
}
