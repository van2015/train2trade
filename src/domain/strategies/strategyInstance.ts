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
   * Aplica una decisión de `evaluate` según la matriz de transiciones.
   * Una acción no aplicable al estado es un bug de integración →
   * `InvalidStrategyTransitionError`. Enter desde Confirmed y Exit desde
   * Closing son refresh (sin cambio); Hold/Add/Reduce nunca mueven el ciclo.
   */
  apply(decision: StrategyDecision): StrategyTransition {
    const from = this.current
    const to = nextState(decision.action, from)
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

/**
 * Matriz de transiciones: estado → acción → estado destino.
 *
 * - Celda ausente = combinación no aplicable (bug de integración).
 * - Self-loop = refresh de la orden pendiente (Enter desde Confirmed, Exit
 *   desde Closing) o acción que no mueve el ciclo (Hold/Add/Reduce).
 * - Especificación completa del ciclo `Closed → Confirmed → Opened → Closing → Closed`.
 */
const TRANSITIONS: Record<StrategyState, Partial<Record<StrategyAction, StrategyState>>> = {
  [StrategyState.Closed]: {
    [StrategyAction.Hold]: StrategyState.Closed,
    [StrategyAction.Enter]: StrategyState.Confirmed,
  },
  [StrategyState.Confirmed]: {
    [StrategyAction.Hold]: StrategyState.Confirmed,
    // Refresh de la orden pendiente (chase): el ciclo no cambia.
    [StrategyAction.Enter]: StrategyState.Confirmed,
    [StrategyAction.Cancel]: StrategyState.Closed,
  },
  [StrategyState.Opened]: {
    [StrategyAction.Hold]: StrategyState.Opened,
    [StrategyAction.Add]: StrategyState.Opened,
    [StrategyAction.Reduce]: StrategyState.Opened,
    [StrategyAction.Exit]: StrategyState.Closing,
  },
  [StrategyState.Closing]: {
    [StrategyAction.Hold]: StrategyState.Closing,
    [StrategyAction.Add]: StrategyState.Closing,
    [StrategyAction.Reduce]: StrategyState.Closing,
    // Refresh de la orden de salida pendiente: el ciclo no cambia.
    [StrategyAction.Exit]: StrategyState.Closing,
  },
}

/** Transición pura según la matriz. Celda ausente → `InvalidStrategyTransitionError`. */
function nextState(action: StrategyAction, from: StrategyState): StrategyState {
  const to = TRANSITIONS[from][action]
  if (to === undefined) {
    throw new InvalidStrategyTransitionError(`${action} no es aplicable desde "${from}"`, action)
  }
  return to
}

/** Evento (§12D) que genera cada acción que mueve el ciclo. */
const EVENTS: Partial<Record<StrategyAction, StrategyEvent>> = {
  [StrategyAction.Enter]: 'StrategyConfirmed',
  [StrategyAction.Cancel]: 'EntryCancelled',
  [StrategyAction.Exit]: 'ExitRequested',
}

/** Evento generado por la transición; `null` si el ciclo no se movió. */
function eventFor(
  action: StrategyAction,
  from: StrategyState,
  to: StrategyState,
): StrategyEvent | null {
  if (from === to) return null
  return EVENTS[action] ?? null
}
