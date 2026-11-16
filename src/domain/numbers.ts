/**
 * Predicados numéricos compartidos por módulos que no deben depender entre sí
 * (`strategies`, `portfolio`, `replay`): viven en una hoja sin imports para
 * que cada uno valide lo mismo sin invertir dependencias.
 */

/** `true` si `fraction` es un número finito en (0, 1] (fracción de tamaño/riesgo). */
export function isUnitFraction(fraction: unknown): fraction is number {
  return typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0 && fraction <= 1
}
