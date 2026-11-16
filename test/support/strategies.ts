import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow, Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

export interface CrossStrategyOptions {
  /**
   * Nombre de la estrategia. Afecta a `strategyId` (`name@version`) y a los ids
   * de experimento, así que cada fichero conserva el suyo.
   */
  name?: string
  version?: number
  /** Regla de entrada; por defecto el cruce al alza `fast > slow`. */
  entry?: Rule
}

/**
 * Estrategia de referencia de los E2E: cruce de SMA(2)/SMA(3) — entra al
 * cruzar al alza y sale al cruzar a la baja.
 */
export function crossStrategy({
  name = 'cross-e2e',
  version,
  entry,
}: CrossStrategyOptions = {}): Strategy {
  return new Strategy({
    name,
    version,
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, entry ?? new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/**
 * Entrada única sin salida: la regla dispara en la primera evaluación y nunca
 * vuelve a hacerlo (anti look-ahead y posición abierta al final).
 */
export function enterOnceStrategy(): Strategy {
  let fired = false
  const rule: Rule = {
    name: 'enter once',
    evaluate: () => {
      if (fired) return false
      fired = true
      return true
    },
  }
  return new Strategy({
    name: 'enter-once',
    signals: [new Signal(StrategyAction.RequestEntry, rule)],
  })
}
