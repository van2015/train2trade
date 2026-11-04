import type { Candle } from './types'

export class InvalidCandlesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCandlesError'
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Normaliza la respuesta cruda del exchange a Candle[]:
 * números finitos, orden ascendente por tiempo, sin duplicados (gana el último)
 * y sin velas inválidas (high < low o campos ausentes).
 */
export function normalizeCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) {
    throw new InvalidCandlesError(
      `Respuesta de velas inválida: se esperaba un array, se recibió ${typeof raw}`,
    )
  }

  const byTime = new Map<number, Candle>()

  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>

    const time = toFiniteNumber(record.time)
    const open = toFiniteNumber(record.open)
    const high = toFiniteNumber(record.high)
    const low = toFiniteNumber(record.low)
    const close = toFiniteNumber(record.close)
    const volume = toFiniteNumber(record.volume)

    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue
    }
    if (high < low) continue

    byTime.set(time, { time, open, high, low, close, volume })
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time)
}
