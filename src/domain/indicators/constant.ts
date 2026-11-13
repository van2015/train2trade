import { Candle } from '@/domain/candles/candle'
import { DomainError, invalidMessage } from '@/domain/errors'
import { Indicator, IndicatorValue, sortedByTime } from './indicator'

export class InvalidConstantError extends DomainError {
  constructor(value: unknown) {
    super(
      'InvalidConstantError',
      invalidMessage('Constante inválida', 'se esperaba un número finito', value),
    )
  }
}

/**
 * Serie constante: devuelve `value` en todas las velas (salida alineada, sin
 * calentamiento). Es la única vía de inyectar un número en reglas o
 * expresiones de precio (decisión 9: los precios no son constantes absolutas,
 * pero un umbral/coeficiente se declara como indicador, p. ej. `rsi30()`).
 */
export class Constant implements Indicator {
  readonly name = 'const'
  readonly value: number

  constructor(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidConstantError(value)
    }
    this.value = value
  }

  calculate(candles: readonly Candle[]): IndicatorValue[] {
    return sortedByTime(candles).map((candle) => ({ time: candle.time, value: this.value }))
  }
}
