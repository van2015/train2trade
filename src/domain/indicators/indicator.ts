import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'

export interface IndicatorValue {
  /** Timestamp de la vela correspondiente (ms UTC). */
  time: number
  /** Valor del indicador; `null` durante el periodo de calentamiento. */
  value: number | null
}

/**
 * Contrato de los indicadores: cálculo puro sobre velas, sin React ni gráficos.
 * La misma entrada produce la misma salida (chart y estrategias comparten código).
 *
 * - La entrada se ordena defensivamente por tiempo (no se muta).
 * - La salida está alineada con la entrada: misma longitud y mismos `time`.
 * - Sin redondeos: el formateo es responsabilidad de la UI.
 */
export interface Indicator {
  /** Identificador estable, p. ej. `"sma"`. */
  readonly name: string
  /** Serie alineada con la entrada: misma longitud y orden ascendente por tiempo. */
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

/** Valida que `period` sea un entero >= 1. Lanza `InvalidPeriodError`; devuelve el valor. */
export function assertPeriod(period: unknown): number {
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 1) {
    throw new InvalidPeriodError(period)
  }
  return period
}

/** Copia de las velas ordenadas ascendente por `time` (nunca muta la entrada). */
export function sortedByTime(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.time - b.time)
}
