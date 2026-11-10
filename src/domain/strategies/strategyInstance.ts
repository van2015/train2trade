import { DomainError, invalidMessage } from '@/domain/errors'
import { Strategy, StrategyAction, StrategyDecision } from './strategy'

export enum StrategyState {
  /** Plano: sin posición ni orden en vuelo; esperando la señal de entrada. */
  WaitingForSignal = 'waiting_for_signal',
  /** Orden de entrada emitida, pendiente de relleno (⇔ entryPending en evaluate). */
  WaitingForEntryFill = 'waiting_for_entry_fill',
  /** Posición abierta (⇔ open en evaluate); esperando la señal de salida. */
  WaitingForExitSignal = 'waiting_for_exit_signal',
  /** Orden de salida emitida, pendiente de relleno (posición aún abierta). */
  WaitingForExitFill = 'waiting_for_exit_fill',
}

/** Eventos de dominio (§12D) generados por las transiciones, para observabilidad. */
export type StrategyEvent =
  | 'StrategyConfirmed' // WaitingForSignal → WaitingForEntryFill  (señal de entrada emitida)
  | 'EntryCancelled' // WaitingForEntryFill → WaitingForSignal  (veto Cancel)
  | 'PositionOpened' // WaitingForEntryFill → WaitingForExitSignal  (entrada rellenada)
  | 'ExitRequested' // WaitingForExitSignal → WaitingForExitFill  (señal de salida emitida)
  | 'PositionClosed' // WaitingForExitFill → WaitingForSignal  (salida rellenada)

export interface StrategyTransition {
  from: StrategyState
  to: StrategyState
  changed: boolean
  /** Evento generado; `null` si la decisión no movió el ciclo (None, refresh, Add/Reduce). */
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
 * Instancia en ejecución de una estrategia: ciclo de vida `WaitingForSignal →
 * WaitingForEntryFill → WaitingForExitSignal → WaitingForExitFill →
 * WaitingForSignal`. La definición no tiene estado; aquí viven `open`
 * y `entryPending`, y las transiciones vienen de las decisiones de `evaluate`
 * (`apply`) y de los rellenos de la ejecución (`onFill`, Fase 3).
 */
export class StrategyInstance {
  readonly strategy: Strategy
  private current: StrategyState

  constructor(strategy: Strategy, initialState: StrategyState = StrategyState.WaitingForSignal) {
    this.strategy = strategy
    this.current = initialState
  }

  get state(): StrategyState {
    return this.current
  }

  /** true ⇔ state es WaitingForExitSignal o WaitingForExitFill (lo que evaluate espera como `open`). */
  get open(): boolean {
    return (
      this.current === StrategyState.WaitingForExitSignal ||
      this.current === StrategyState.WaitingForExitFill
    )
  }

  /** true ⇔ state es WaitingForEntryFill (lo que evaluate espera como `entryPending`). */
  get entryPending(): boolean {
    return this.current === StrategyState.WaitingForEntryFill
  }

  /**
   * Aplica una decisión de `evaluate` según la matriz de transiciones.
   * Una acción no aplicable al estado es un bug de integración →
   * `InvalidStrategyTransitionError`. Enter desde WaitingForEntryFill y Exit
   * desde WaitingForExitFill son refresh (sin cambio); None/Add/Reduce nunca
   * mueven el ciclo.
   */
  apply(decision: StrategyDecision): StrategyTransition {
    const from = this.current
    const to = nextState(decision.action, from)
    this.current = to
    return { from, to, changed: from !== to, event: eventFor(decision.action, from, to) }
  }

  /**
   * Confirmación de relleno de la orden pendiente (la envía la ejecución, Fase 3):
   * WaitingForEntryFill → WaitingForExitSignal (`PositionOpened`);
   * WaitingForExitFill → WaitingForSignal (`PositionClosed`).
   * Sin orden pendiente → `InvalidStrategyTransitionError`.
   */
  onFill(): StrategyTransition {
    const from = this.current
    const to =
      from === StrategyState.WaitingForEntryFill
        ? StrategyState.WaitingForExitSignal
        : from === StrategyState.WaitingForExitFill
          ? StrategyState.WaitingForSignal
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
      event: from === StrategyState.WaitingForEntryFill ? 'PositionOpened' : 'PositionClosed',
    }
  }
}

/**
 * Matriz de transiciones: estado → acción → estado destino.
 *
 * - Celda ausente = combinación no aplicable (bug de integración).
 * - Self-loop = refresh de la orden pendiente (Enter desde WaitingForEntryFill,
 *   Exit desde WaitingForExitFill) o acción que no mueve el ciclo
 *   (None/Add/Reduce).
 * - Especificación completa del ciclo `WaitingForSignal → WaitingForEntryFill →
 *   WaitingForExitSignal → WaitingForExitFill → WaitingForSignal`.
 */
const TRANSITIONS: Record<StrategyState, Partial<Record<StrategyAction, StrategyState>>> = {
  [StrategyState.WaitingForSignal]: {
    [StrategyAction.None]: StrategyState.WaitingForSignal,
    [StrategyAction.Enter]: StrategyState.WaitingForEntryFill,
  },
  [StrategyState.WaitingForEntryFill]: {
    [StrategyAction.None]: StrategyState.WaitingForEntryFill,
    // Refresh de la orden pendiente (chase): el ciclo no cambia.
    [StrategyAction.Enter]: StrategyState.WaitingForEntryFill,
    [StrategyAction.Cancel]: StrategyState.WaitingForSignal,
  },
  [StrategyState.WaitingForExitSignal]: {
    [StrategyAction.None]: StrategyState.WaitingForExitSignal,
    [StrategyAction.Add]: StrategyState.WaitingForExitSignal,
    [StrategyAction.Reduce]: StrategyState.WaitingForExitSignal,
    [StrategyAction.Exit]: StrategyState.WaitingForExitFill,
  },
  [StrategyState.WaitingForExitFill]: {
    [StrategyAction.None]: StrategyState.WaitingForExitFill,
    [StrategyAction.Add]: StrategyState.WaitingForExitFill,
    [StrategyAction.Reduce]: StrategyState.WaitingForExitFill,
    // Refresh de la orden de salida pendiente: el ciclo no cambia.
    [StrategyAction.Exit]: StrategyState.WaitingForExitFill,
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
