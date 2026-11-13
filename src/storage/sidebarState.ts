/**
 * Sección plegable del sidebar (plan UI, T2): persistencia de la sección
 * abierta con `Storage` inyectado, mismo patrón que los repositorios.
 * Cualquier fallo (modo privado, cuota, JSON roto) degrada a "sin preferencia".
 */
const SECTION_KEY = 'ui:sidebar-section'

/** Devuelve la sección abierta persistida, o null si no hay o no se puede leer. */
export function loadOpenSection(storage: Storage | null): string | null {
  if (storage === null) return null
  try {
    return storage.getItem(SECTION_KEY)
  } catch {
    return null
  }
}

/** Persiste la sección abierta; `null` borra la clave (sin sección guardada). */
export function saveOpenSection(storage: Storage | null, id: string | null): void {
  if (storage === null) return
  try {
    if (id === null) storage.removeItem(SECTION_KEY)
    else storage.setItem(SECTION_KEY, id)
  } catch {
    // Storage no disponible: la UI sigue funcionando con el estado en memoria.
  }
}
