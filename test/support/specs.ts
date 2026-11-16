import { StrategySpec } from '@/domain/strategies/spec'

export interface SMAcrossSpecOptions {
  /** Periodo de la SMA rápida (por defecto 2). */
  fast?: number
  /** Periodo de la SMA lenta (por defecto 3). */
  slow?: number
}

/**
 * Spec de referencia `sma-cross`: cruce al alza de SMA(fast)/SMA(slow) para
 * entrar y cruce a la baja para salir, a mercado. Es la estrategia por
 * defecto de los tests de paneles y E2E.
 */
export function smaCrossSpec({ fast = 2, slow = 3 }: SMAcrossSpecOptions = {}): StrategySpec {
  return {
    name: 'sma-cross',
    version: 1,
    indicators: [
      { alias: 'fast', kind: 'sma', period: fast },
      { alias: 'slow', kind: 'sma', period: slow },
    ],
    entry: {
      rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
      execution: 'market',
    },
    exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
  }
}
