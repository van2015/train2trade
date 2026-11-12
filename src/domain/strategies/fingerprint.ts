import { Strategy } from '@/domain/strategies/strategy'

/**
 * Serialización canónica (§12C): JSON determinista para detectar cambios.
 * Reglas:
 *
 * - solo **props propios enumerables** (los métodos del prototipo y los
 *   callbacks `function` se omiten: la minificación no cambia la huella);
 * - **claves ordenadas** alfabéticamente (orden de código de unit, no
 *   localizado), recursivo; los **arrays conservan su orden**;
 * - `undefined` y no finitos (`NaN`/`Infinity`) → `null`; `Date` → ISO;
 * - los `Map` se serializan como registro con claves ordenadas (no como `{}`).
 *
 * No pretende ser JSON canónico de IETF: es detección de cambios
 * reproducible, no seguridad criptográfica.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value)
}

/**
 * Huella reproducible de una estrategia (§12C): FNV-1a de 32 bits sobre el
 * JSON canónico → hex de 8 dígitos. Misma definición reconstruida → misma
 * huella; cualquier cambio de props (nombre, versión, periodo, orden de
 * señales, reglas, veto) → huella distinta. Estable entre ejecuciones.
 */
export function strategyFingerprint(strategy: Strategy): string {
  return canonicalHash(strategy)
}

/**
 * Hash FNV-1a del JSON canónico: ids deterministas de **contenido** (p. ej.
 * el `id` de un `ExperimentSnapshot`, que se calcula sobre el snapshot sin
 * `id`). Detección de cambios, no seguridad criptográfica.
 */
export function canonicalHash(value: unknown): string {
  return fnv1aHex(canonicalJson(value))
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'function':
    case 'bigint':
    case 'symbol':
      return 'null'
    case 'object':
      break
    default:
      return 'null'
  }

  if (Array.isArray(value)) {
    const items: string[] = []
    for (const item of value) {
      if (typeof item === 'function' || item === undefined) continue
      items.push(stringify(item))
    }
    return `[${items.join(',')}]`
  }

  if (value instanceof Date) {
    return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString())
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .filter(([, entryValue]) => isSerializable(entryValue))
      .map(([key, entryValue]) => [String(key), entryValue] as const)
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stringify(entryValue)}`)
    return `{${entries.join(',')}}`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => isSerializable(entryValue))
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stringify(entryValue)}`)
  return `{${entries.join(',')}}`
}

/** Propiedades ausentes o callbacks se omiten (no aportan a la huella). */
function isSerializable(value: unknown): boolean {
  return typeof value !== 'function' && value !== undefined
}

/** Orden lexicográfico estable por código de unit (independiente de la locale). */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** FNV-1a de 32 bits sobre UTF-16 → hex de 8 dígitos (detección, no cripto). */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
