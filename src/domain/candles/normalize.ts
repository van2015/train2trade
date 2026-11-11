import { Candle, InvalidCandlesError } from './candle'

/**
 * Respuesta cruda del exchange → `Candle[]`: invariantes delegados en
 * `Candle.from`, orden ascendente y sin duplicados (gana el último).
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
      // Vela inválida: se descarta para no interrumpir la importación.
    }
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time)
}
