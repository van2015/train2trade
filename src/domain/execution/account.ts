import { Fill } from '@/domain/execution/fill'
import { Position } from '@/domain/execution/position'

/**
 * Puerto (§6) que `execution` necesita de la cuenta: el broker solo lee
 * efectivo y posición y aplica rellenos. `Portfolio` (§8) lo implementa, de
 * modo que la dependencia va en un solo sentido `portfolio → execution` y no
 * hay ciclo entre paquetes.
 *
 * Invariantes que el implementador garantiza:
 * - `cash >= 0` (una compra que lo rompería se rechaza antes de `applyFill`);
 * - `position = null` sin posición o tras el cierre total;
 * - `applyFill` escribe efectivo y posición de forma atómica por relleno.
 */
export interface Account {
  /** Efectivo disponible en la unidad cotizada. */
  readonly cash: number
  /** Posición larga abierta; `null` sin posición. */
  readonly position: Position | null
  /** Aplica un relleno a efectivo y posición. */
  applyFill(fill: Fill): void
}
