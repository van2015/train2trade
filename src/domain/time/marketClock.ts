import { DomainError, invalidMessage } from '@/domain/errors'

export class MarketClockError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('MarketClockError', invalidMessage('Reloj de mercado inválido', reason, raw))
  }
}

/**
 * Tiempo de simulación (§12A): avance controlado e independiente del reloj del
 * sistema — determinista, nunca lee `Date.now`. El tiempo es estrictamente
 * creciente (no se repite ni se retrocede una vela), el mismo invariante
 * monótono que exige `StrategyRunner`. Base del replay interactivo (Fase 5).
 */
export class MarketClock {
  private current: number | null = null

  /** Tiempo de simulación actual (ms UTC); `null` antes del primer avance. */
  get now(): number | null {
    return this.current
  }

  /** Avanza a `time`. No finito, negativo o no creciente → `MarketClockError` sin cambiar el estado. */
  advanceTo(time: number): void {
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
      throw new MarketClockError('time debe ser un timestamp finito >= 0 (ms)', time)
    }
    if (this.current !== null && time <= this.current) {
      throw new MarketClockError(
        `time debe ser estrictamente mayor que el actual (${this.current})`,
        time,
      )
    }
    this.current = time
  }
}
