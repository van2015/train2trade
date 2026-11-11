import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'

export interface IndicatorValue {
  /** Timestamp de la vela correspondiente (ms UTC). */
  time: number
  /** Valor del indicador; `null` durante el periodo de calentamiento. */
  value: number | null
}

/**
 * Contrato de indicadores: cálculo puro, sin React ni gráficos (chart y
 * estrategias comparten el mismo código). La salida está alineada con la
 * entrada y sin redondeos (el formateo es de la UI).
 */
export interface Indicator {
  /** Identificador estable, p. ej. `"sma"`. */
  readonly name: string
  calculate(candles: readonly Candle[]): IndicatorValue[]
}

export class InvalidPeriodError extends DomainError {
  constructor(period: unknown) {
    super(
      'InvalidPeriodError',
      invalidMessage('Periodo inválido', 'se esperaba un entero >= 1', period),
    )
  }
}

/** Valida y devuelve `period` (entero >= 1); lanza `InvalidPeriodError`. */
export function assertPeriod(period: unknown): number {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new InvalidPeriodError(period)
  }
  return period
}

/** Copia de las velas ordenadas por `time` (nunca muta la entrada). */
export function sortedByTime(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.time - b.time)
}
