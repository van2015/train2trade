import { ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Trade, TradeData } from '@/domain/backtest/trade'
import { Timeframe } from '@/domain/candles/timeframe'
import { CorruptedStorageError } from '@/storage/errors'

/** Prefijo de claves (convive con `candles:` en el mismo Storage). */
const KEY_PREFIX = 'experiments:'

/** Espejo de las claves que produce `computeMetrics` (§9, conjunto mínimo de 8). */
const METRIC_KEYS = [
  'netProfit',
  'roi',
  'maxDrawdown',
  'sharpe',
  'profitFactor',
  'winRate',
  'avgTrade',
  'expectancy',
] as const

/** Snapshot en crudo (JSON): los trades aún sin reconstruir. */
type SnapshotData = Omit<ExperimentSnapshot, 'trades'> & { trades: readonly TradeData[] }

/**
 * Repositorio de experimentos con `Storage` inyectado (mismo patrón que
 * `CandleRepository`). Clave `experiments:<id>`; el `id` es determinístico
 * (hash del contenido), así que **re-guardar el mismo experimento lo
 * sobrescribe** (sin duplicados, §12C). JSON corrupto o snapshot inválido →
 * `CorruptedStorageError`.
 */
export class ExperimentRepository {
  private readonly storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  /** Guarda (sobrescribe) el snapshot en `experiments:<id>`. */
  save(snapshot: ExperimentSnapshot): void {
    this.storage.setItem(`${KEY_PREFIX}${snapshot.id}`, JSON.stringify(snapshot))
  }

  /** Snapshot por id; inexistente → `null`; corrupto → `CorruptedStorageError`. */
  find(id: string): ExperimentSnapshot | null {
    const key = `${KEY_PREFIX}${id}`
    const raw = this.storage.getItem(key)
    if (raw === null) return null
    return parseSnapshot(raw, key)
  }

  /** Todos los snapshots: `period.from` descendente; empate por `id` ascendente. */
  list(): ExperimentSnapshot[] {
    const snapshots: ExperimentSnapshot[] = []
    for (const key of this.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue
      const raw = this.storage.getItem(key)
      if (raw === null) continue
      snapshots.push(parseSnapshot(raw, key))
    }
    return snapshots.sort(byPeriodThenId)
  }

  /** Borra la clave. `true` si había un snapshot. */
  remove(id: string): boolean {
    const key = `${KEY_PREFIX}${id}`
    const existed = this.storage.getItem(key) !== null
    this.storage.removeItem(key)
    return existed
  }

  /** Elimina todas las claves de experimentos (solo las nuestras). */
  clear(): void {
    for (const key of this.keys()) {
      if (key.startsWith(KEY_PREFIX)) this.storage.removeItem(key)
    }
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

/** Orden determinista: `period.from` descendente; empate por `id` ascendente. */
function byPeriodThenId(a: ExperimentSnapshot, b: ExperimentSnapshot): number {
  if (a.period.from !== b.period.from) return b.period.from - a.period.from
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** Parsea y valida un snapshot del storage; cualquier problema → `CorruptedStorageError`. */
function parseSnapshot(raw: string, key: string): ExperimentSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new CorruptedStorageError('el JSON no es válido', key, error)
  }

  if (!isSnapshotShape(parsed)) {
    throw new CorruptedStorageError('el snapshot no tiene la forma esperada', key, parsed)
  }

  try {
    return { ...parsed, trades: parsed.trades.map((trade) => Trade.from(trade)) }
  } catch (error) {
    throw new CorruptedStorageError('el snapshot contiene trades inválidos', key, error)
  }
}

/** Forma mínima del snapshot: tipos correctos; los trades se validan en `Trade.from`. */
function isSnapshotShape(value: unknown): value is SnapshotData {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.strategyId === 'string' &&
    typeof value.fingerprint === 'string' &&
    (value.instrument === null || typeof value.instrument === 'string') &&
    typeof value.timeframe === 'string' &&
    Timeframe.isCode(value.timeframe) &&
    isPeriod(value.period) &&
    isPositiveNumber(value.initialCapital) &&
    isExecution(value.execution) &&
    isRisk(value.risk) &&
    isMetrics(value.metrics) &&
    isFiniteNumber(value.finalEquity) &&
    isEquityCurve(value.equityCurve) &&
    Array.isArray(value.trades) &&
    value.trades.every((trade) => isRecord(trade))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isPeriod(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.from) && isFiniteNumber(value.to)
}

function isExecution(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.slippageBps) &&
    isFiniteNumber(value.feeBps) &&
    value.slippageBps >= 0 &&
    value.feeBps >= 0
  )
}

function isRisk(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.maxPositionFraction) &&
    isFiniteNumber(value.minCashReserve) &&
    isFiniteNumber(value.feeBps) &&
    isFiniteNumber(value.slippageBps)
  )
}

function isMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false
  return METRIC_KEYS.every((key) => {
    const metric = value[key]
    return metric === null || isFiniteNumber(metric)
  })
}

function isEquityCurve(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every(
    (point) => isRecord(point) && isFiniteNumber(point.time) && isFiniteNumber(point.equity),
  )
}
