import { canonicalHash } from '@/domain/strategies/fingerprint'
import { parseStrategySpec, StrategySpec } from '@/domain/strategies/spec'
import { CorruptedStorageError } from '@/storage/errors'

/** Prefijo de claves (convive con `experiments:` y `candles:` en el mismo Storage). */
const KEY_PREFIX = 'strategies:'

/** Snapshot persistido: el spec completo + su `id` (hash del contenido). */
export type StrategySnapshot = StrategySpec & { id: string }

/**
 * Demo `sma-cross` (§1.7): semilla cuando el storage está vacío. Cruce de
 * SMA(10)/SMA(30) a mercado (los parámetros por defecto de los paneles).
 */
export const DEMO_STRATEGY_SPEC: StrategySpec = {
  name: 'sma-cross',
  version: 1,
  indicators: [
    { alias: 'fast', kind: 'sma', period: 10 },
    { alias: 'slow', kind: 'sma', period: 30 },
  ],
  entry: {
    rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
    execution: 'market',
  },
  exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
}

/**
 * Repositorio de estrategias con `Storage` inyectado (mismo patrón que
 * `ExperimentRepository`). Claves `strategies:<id>`; el `id` es el hash
 * determinista del **contenido** del spec → misma spec = misma clave y
 * re-guardar sobrescribe (sin duplicados, §12C). El `id` vive solo en la
 * clave: al leer se inyecta en el snapshot.
 *
 * - Escritura inválida (spec malformado) → `InvalidStrategyDefinitionError`
 *   (error del llamante, no datos corruptos).
 * - Lectura corrupta (JSON o forma) → `CorruptedStorageError`.
 */
export class StrategyRepository {
  private readonly storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  /** Valida la forma, guarda (sobrescribe) y devuelve el `id` determinístico. */
  save(spec: StrategySpec): string {
    const valid = parseStrategySpec(spec)
    const id = canonicalHash(valid)
    this.storage.setItem(`${KEY_PREFIX}${id}`, JSON.stringify(valid))
    return id
  }

  /** Snapshot por id; inexistente → `null`; corrupto → `CorruptedStorageError`. */
  find(id: string): StrategySnapshot | null {
    const key = `${KEY_PREFIX}${id}`
    const raw = this.storage.getItem(key)
    if (raw === null) return null
    return { id, ...parseSpec(raw, key) }
  }

  /** Todos los snapshots: `name` ascendente, `version` descendente; empate por `id`. */
  list(): StrategySnapshot[] {
    const snapshots: StrategySnapshot[] = []
    for (const key of this.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue
      const raw = this.storage.getItem(key)
      if (raw === null) continue
      const id = key.slice(KEY_PREFIX.length)
      snapshots.push({ id, ...parseSpec(raw, key) })
    }
    return snapshots.sort(byNameThenVersion)
  }

  /** Borra la clave. `true` si había un snapshot. */
  remove(id: string): boolean {
    const key = `${KEY_PREFIX}${id}`
    const existed = this.storage.getItem(key) !== null
    this.storage.removeItem(key)
    return existed
  }

  /** Elimina todas las claves de estrategias (solo las nuestras). */
  clear(): void {
    for (const key of this.keys()) {
      if (key.startsWith(KEY_PREFIX)) this.storage.removeItem(key)
    }
  }

  /**
   * Si no hay ninguna estrategia, guarda la demo (§1.7). Devuelve `true` si
   * sembró: la UI nunca arranca con la lista vacía.
   */
  seedIfEmpty(): boolean {
    if (this.keys().some((key) => key.startsWith(KEY_PREFIX))) return false
    this.save(DEMO_STRATEGY_SPEC)
    return true
  }

  private keys(): string[] {
    const keys: string[] = []
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index)
      if (key !== null) keys.push(key)
    }
    return keys
  }
}

/** Parsea y valida un spec del storage; cualquier problema → `CorruptedStorageError`. */
function parseSpec(raw: string, key: string): StrategySpec {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new CorruptedStorageError('el JSON no es válido', key, error)
  }

  try {
    return parseStrategySpec(parsed)
  } catch (error) {
    throw new CorruptedStorageError('el spec no tiene la forma esperada', key, error)
  }
}

/** Orden determinista: `name` ascendente, `version` descendente, empate por `id`. */
function byNameThenVersion(a: StrategySnapshot, b: StrategySnapshot): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.version !== b.version) return b.version - a.version
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
