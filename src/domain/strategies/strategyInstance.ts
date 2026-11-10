import { DomainError, invalidMessage } from '@/domain/errors'
import { Strategy, StrategyAction, StrategyDecision } from './strategy'

export enum StrategyState {
  /** Estado inicial y tras cerrar: sin posición ni señal pendiente. */
  Closed = 'closed',
  /** Entrada emitida, pendiente de rellenar (⇔ entryPending en evaluate). */
  Confirmed = 'confirmed',
  /** Posición abierta (⇔ open en evaluate). */
  Opened = 'opened',
  /** Salida emitida, pendiente de rellenar (posición aún abierta). */
  Closing = 'closing',
}

/** Eventos de dominio (§12D) generados por las transiciones, para observabilidad. */
export type StrategyEvent =
  | 'StrategyConfirmed' // Closed → Confirmed  (señal de entrada emitida)
  | 'EntryCancelled' // Confirmed → Closed  (veto Cancel)
  | 'PositionOpened' // Confirmed → Opened  (entrada rellenada)
  | 'ExitRequested' // Opened → Closing    (señal de salida emitida)
  | 'PositionClosed' // Closing → Closed    (salida rellenada)

export interface StrategyTransition {
  from: StrategyState
  to: StrategyState
  changed: boolean
  /** Evento generado; `null` si la decisión no movió el ciclo (Hold, refresh, Add/Reduce). */
  event: StrategyEvent | null
}

export class InvalidStrategyTransitionError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super(
      'InvalidStrategyTransitionError',
      invalidMessage('Transición de estrategia inválida', reason, raw),
    )
  }
}

/**
 * Instancia en ejecución de una estrategia: ciclo de vida `Closed → Confirmed →
 * Opened → Closing → Closed`. La definición no tiene estado; aquí viven `open`
 * y `entryPending`, y las transiciones vienen de las decisiones de `evaluate`
 * (`apply`) y de los rellenos de la ejecución (`onFill`, Fase 3).
 */
export class StrategyInstance {
  readonly strategy: Strategy
  private current: StrategyState

  constructor(strategy: Strategy, initialState: StrategyState = StrategyState.Closed) {
    this.strategy = strategy
    this.current = initialState
  }

  get state(): StrategyState {
    return this.current
  }

  /** true ⇔ state es Opened o Closing (lo que evaluate espera como `open`). */
  get open(): boolean {
    return this.current === StrategyState.Opened || this.current === StrategyState.Closing
  }

  /** true ⇔ state es Confirmed (lo que evaluate espera como `entryPending`). */
  get entryPending(): boolean {
    return this.current === StrategyState.Confirmed
  }

  /**
   * Aplica una decisión de `evaluate`. `Hold`, `Add`, `Reduce` no cambian estado
   * (Add/Reduce solo desde Opened/Closing). Una decisión no aplicable al estado
   * es un bug de integración → `InvalidStrategyTransitionError`.
   * Enter desde Confirmed y Exit desde Closing son refresh (sin cambio).
   */
  apply(decision: StrategyDecision): StrategyTransition {
    const from = this.current
    // Inicializado en `from` (Hold por defecto); cada acción lo sobrescribe o lanza.
    let to: StrategyState = from

    switch (decision.action) {
      case StrategyAction.Hold:
        to = from
        break
      case StrategyAction.Enter:
        if (from === StrategyState.Confirmed) {
          // Refresh de la orden pendiente (chase): el ciclo no cambia.
          to = from
          break
        }
        if (from !== StrategyState.Closed) {
          throw new InvalidStrategyTransitionError(
            `Enter no es aplicable desde "${from}"`,
            decision.action,
          )
        }
        to = StrategyState.Confirmed
        break
      case StrategyAction.Cancel:
        if (from !== StrategyState.Confirmed) {
          throw new InvalidStrategyTransitionError(
            `Cancel no es aplicable desde "${from}"`,
            decision.action,
          )
        }
        to = StrategyState.Closed
        break
      case StrategyAction.Exit:
        if (from === StrategyState.Closing) {
          // Refresh de la orden de salida pendiente: el ciclo no cambia.
          to = from
          break
        }
        if (from !== StrategyState.Opened) {
          throw new InvalidStrategyTransitionError(
            `Exit no es aplicable desde "${from}"`,
            decision.action,
          )
        }
        to = StrategyState.Closing
        break
      case StrategyAction.Add:
      case StrategyAction.Reduce:
        if (from !== StrategyState.Opened && from !== StrategyState.Closing) {
          throw new InvalidStrategyTransitionError(
            `${decision.action} no es aplicable desde "${from}"`,
            decision.action,
          )
        }
        to = from
        break
    }

    this.current = to
    return { from, to, changed: from !== to, event: eventFor(decision.action, from, to) }
  }

  /**
   * Confirmación de relleno de la orden pendiente (la envía la ejecución, Fase 3):
   * Confirmed → Opened (`PositionOpened`); Closing → Closed (`PositionClosed`).
   * Sin orden pendiente → `InvalidStrategyTransitionError`.
   */
  onFill(): StrategyTransition {
    const from = this.current
    const to =
      from === StrategyState.Confirmed
        ? StrategyState.Opened
        : from === StrategyState.Closing
          ? StrategyState.Closed
          : null

    if (to === null) {
      throw new InvalidStrategyTransitionError(
        `onFill no es aplicable en "${from}": no hay orden pendiente`,
        from,
      )
    }

    this.current = to
    return {
      from,
      to,
      changed: true,
      event: from === StrategyState.Confirmed ? 'PositionOpened' : 'PositionClosed',
    }
  }
}

function eventFor(
  action: StrategyAction,
  from: StrategyState,
  to: StrategyState,
): StrategyEvent | null {
  if (from === to) return null
  if (action === StrategyAction.Enter && to === StrategyState.Confirmed) return 'StrategyConfirmed'
  if (action === StrategyAction.Cancel && to === StrategyState.Closed) return 'EntryCancelled'
  if (action === StrategyAction.Exit && to === StrategyState.Closing) return 'ExitRequested'
  return null
}
