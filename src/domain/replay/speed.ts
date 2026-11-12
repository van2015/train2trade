import { Timeframe } from '@/domain/candles/timeframe'
import { ReplayError } from '@/domain/replay/replayEngine'

/**
 * Presets de velocidad (§7B: "aumentar o reducir la velocidad"). 1× es
 * **tiempo real**: una vela de 1 h tarda 1 h; 3600× la adelanta a 1 s.
 */
export const REPLAY_SPEEDS: readonly number[] = [0.5, 1, 10, 60, 600, 3600]

/** Tope inferior: ~60 fps — por debajo el render por paso no da abasto. */
export const MIN_REPLAY_INTERVAL_MS = 16

/** Tope superior: 1 h por paso — por encima el control deja de ser útil. */
export const MAX_REPLAY_INTERVAL_MS = 3_600_000

/**
 * Intervalo en ms entre pasos del replay: tiempo real (`timeframe.ms`)
 * dividido por el `speed` (multiplicador en tiempo real, §7B), acotado a
 * `[16 ms, 1 h]`. Determinista y puro: mismas entradas → mismo intervalo.
 *
 * `speed` no finito o ≤ 0 → `ReplayError` (la UI siempre pasa un preset de
 * `REPLAY_SPEEDS`).
 */
export function replayIntervalMs(timeframe: Timeframe, speed: number): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    throw new ReplayError('speed debe ser un número finito > 0', speed)
  }

  const realTime = timeframe.ms / speed
  return Math.min(Math.max(realTime, MIN_REPLAY_INTERVAL_MS), MAX_REPLAY_INTERVAL_MS)
}
