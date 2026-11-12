import { Candle } from '@/domain/candles/candle'
import { DomainError, invalidMessage } from '@/domain/errors'

export class SplitError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('SplitError', invalidMessage('División de velas inválida', reason, raw))
  }
}

export interface CandleSplit {
  /** Filtro: `development` = `time < cutTime`; `evaluation` = `time >= cutTime`. */
  cutTime: number
  development: readonly Candle[]
  evaluation: readonly Candle[]
}

/**
 * Parte una serie por tiempo (§7C, test-forward): el corte debe ser
 * **estrictamente interior** — al menos una vela en cada lado — o `SplitError`.
 * Valida velas no vacías y estrictamente ascendentes (sin duplicados); la
 * partición conserva el orden y no pierde ni duplica velas.
 */
export function splitCandles(candles: readonly Candle[], cutTime: number): CandleSplit {
  if (candles.length === 0) {
    throw new SplitError('se necesita al menos una vela', candles.length)
  }
  if (typeof cutTime !== 'number' || !Number.isFinite(cutTime)) {
    throw new SplitError('cutTime debe ser un timestamp finito (ms)', cutTime)
  }

  const development: Candle[] = []
  const evaluation: Candle[] = []
  let previous = Number.NEGATIVE_INFINITY

  for (const candle of candles) {
    if (candle.time <= previous) {
      throw new SplitError('las velas deben ser ascendentes y sin duplicados', candle.time)
    }
    previous = candle.time
    ;(candle.time < cutTime ? development : evaluation).push(candle)
  }

  if (development.length === 0) {
    throw new SplitError('el corte debe dejar al menos una vela en desarrollo', cutTime)
  }
  if (evaluation.length === 0) {
    throw new SplitError('el corte debe dejar al menos una vela en evaluación', cutTime)
  }

  return { cutTime, development, evaluation }
}
