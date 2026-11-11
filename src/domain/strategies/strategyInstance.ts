import { DomainError, invalidMessage } from '@/domain/errors'
import { Strategy, StrategyAction, StrategyDecision } from './strategy'

export enum StrategyState {
  /** Plano: esperando la señal de entrada. */
  WaitingForSignal = 'waiting_for_signal',
  /** Orden de entrada emitida, pendiente de relleno. */
  WaitingForEntryFill = 'waiting_for_entry_fill',
  /** Posición abierta: esperando la señal de salida. */
  WaitingForExitSignal = 'waiting_for_exit_signal',
  /** Orden de salida emitida, pendiente de relleno (posición aún abierta). */
  WaitingForExitFill = 'waiting_for_exit_fill',
}

/** Eventos de dominio (§12D) para observabilidad. */
export type StrategyEvent =
  'StrategyConfirmed' | 'EntryCancelled' | 'PositionOpened' | 'ExitRequested' | 'PositionClosed'

export interface StrategyTransition {
  from: StrategyState
  to: StrategyState
  changed: boolean
  /** `null` si el ciclo no se movió. */
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
 * Ciclo de vida de una estrategia en ejecución: las transiciones llegan de
 * `evaluate` (`apply`) y de los rellenos de la ejecución (`onFill`, Fase 3).
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

  get open(): boolean {
    return (
      this.current === StrategyState.WaitingForExitSignal ||
      this.current === StrategyState.WaitingForExitFill
    )
  }

  get entryPending(): boolean {
    return this.current === StrategyState.WaitingForEntryFill
  }

  /** Acción no aplicable al estado → `InvalidStrategyTransitionError` (bug de integración). */
  apply(decision: StrategyDecision): StrategyTransition {
    const from = this.current
    const to = nextState(decision.action, from)
    this.current = to
    return { from, to, changed: from !== to, event: eventFor(decision.action, from, to) }
  }

  /** Relleno de la orden pendiente (lo notifica la ejecución); sin orden pendiente → error. */
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
 * Matriz de transiciones (especificación del ciclo): celda ausente = no
 * aplicable; self-loop = no mueve el ciclo.
 */
const TRANSITIONS: Record<StrategyState, Partial<Record<StrategyAction, StrategyState>>> = {
  [StrategyState.WaitingForSignal]: {
    [StrategyAction.None]: StrategyState.WaitingForSignal,
    [StrategyAction.RequestEntry]: StrategyState.WaitingForEntryFill,
    [StrategyAction.Invalidate]: StrategyState.WaitingForSignal,
  },
  [StrategyState.WaitingForEntryFill]: {
    [StrategyAction.None]: StrategyState.WaitingForEntryFill,
    [StrategyAction.RequestEntry]: StrategyState.WaitingForEntryFill, // refresh (chase)
    [StrategyAction.Invalidate]: StrategyState.WaitingForSignal, // el veto retira la orden
  },
  [StrategyState.WaitingForExitSignal]: {
    [StrategyAction.None]: StrategyState.WaitingForExitSignal,
    [StrategyAction.RequestAdd]: StrategyState.WaitingForExitSignal,
    [StrategyAction.RequestReduce]: StrategyState.WaitingForExitSignal,
    [StrategyAction.RequestExit]: StrategyState.WaitingForExitFill,
    [StrategyAction.Invalidate]: StrategyState.WaitingForExitSignal,
  },
  [StrategyState.WaitingForExitFill]: {
    [StrategyAction.None]: StrategyState.WaitingForExitFill,
    [StrategyAction.RequestAdd]: StrategyState.WaitingForExitFill,
    [StrategyAction.RequestReduce]: StrategyState.WaitingForExitFill,
    [StrategyAction.RequestExit]: StrategyState.WaitingForExitFill, // refresh
    [StrategyAction.Invalidate]: StrategyState.WaitingForExitFill,
  },
}

function nextState(action: StrategyAction, from: StrategyState): StrategyState {
  const to = TRANSITIONS[from][action]
  if (to === undefined) {
    throw new InvalidStrategyTransitionError(`${action} no es aplicable desde "${from}"`, action)
  }
  return to
}

const EVENTS: Partial<Record<StrategyAction, StrategyEvent>> = {
  [StrategyAction.RequestEntry]: 'StrategyConfirmed',
  [StrategyAction.Invalidate]: 'EntryCancelled',
  [StrategyAction.RequestExit]: 'ExitRequested',
}

function eventFor(
  action: StrategyAction,
  from: StrategyState,
  to: StrategyState,
): StrategyEvent | null {
  if (from === to) return null
  return EVENTS[action] ?? null
}
