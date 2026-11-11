import { DomainError } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { normalizeCandles } from '@/domain/candles/normalize'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

/** Prefijo de claves (deja espacio para otros repos en el mismo Storage). */
const KEY_PREFIX = 'candles:'

/** Rango de consulta por timestamps Unix en ms (ambos límites inclusivos). */
export interface CandleRange {
  from?: number
  to?: number
}

export class CorruptedStorageError extends DomainError {
  constructor(reason: string, key: string, cause?: unknown) {
    super(
      'CorruptedStorageError',
      `Datos corruptos en "${key}": ${reason}`,
      cause !== undefined ? { cause } : undefined,
    )
  }
}

function keyOf(instrument: Instrument, timeframe: Timeframe): string {
  return `${KEY_PREFIX}${instrument.toString()}:${timeframe.toString()}`
}

function bySymbol(a: Instrument, b: Instrument): number {
  return a.toString() < b.toString() ? -1 : 1
}

/**
 * Repositorio de velas con `Storage` inyectado (localStorage en prod, doble en
 * memoria en tests). Clave `candles:BTC/USDT:1h`; corrupta → `CorruptedStorageError`.
 */
export class CandleRepository {
  private readonly storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  /** Mergea velas en la clave: dedupe (gana la nueva) + orden ascendente. `[]` es no-op. */
  save(instrument: Instrument, timeframe: Timeframe, candles: readonly Candle[]): void {
    if (candles.length === 0) return

    const key = keyOf(instrument, timeframe)
    const merged = normalizeCandles([...this.read(key), ...candles])
    this.storage.setItem(key, JSON.stringify(merged))
  }

  /** Velas en `range` inclusivo; `from > to` → `RangeError`. */
  find(instrument: Instrument, timeframe: Timeframe, range?: CandleRange): Candle[] {
    const from = range?.from
    const to = range?.to
    if (from !== undefined && to !== undefined && from > to) {
      throw new RangeError('Rango de fechas inválido: from no puede ser mayor que to')
    }

    const candles = this.read(keyOf(instrument, timeframe))
    if (from === undefined && to === undefined) return candles

    return candles.filter(
      (candle) =>
        (from === undefined || candle.time >= from) && (to === undefined || candle.time <= to),
    )
  }

  /** Número de velas almacenadas para esa clave (0 si no existe). */
  count(instrument: Instrument, timeframe: Timeframe): number {
    return this.read(keyOf(instrument, timeframe)).length
  }

  /** Borra la clave. `true` si había datos. */
  remove(instrument: Instrument, timeframe: Timeframe): boolean {
    const key = keyOf(instrument, timeframe)
    const existed = this.storage.getItem(key) !== null
    this.storage.removeItem(key)
    return existed
  }

  /** Timeframes con datos para un instrumento, ordenados por ms ascendente. */
  listTimeframes(instrument: Instrument): Timeframe[] {
    const prefix = `${KEY_PREFIX}${instrument.toString()}:`
    const codes = new Set(
      this.keys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    )
    return Timeframe.ALL.filter((timeframe) => codes.has(timeframe.code))
  }

  /** Instrumentos con datos almacenados, ordenados por `toString()`. */
  listInstruments(): Instrument[] {
    const symbols = new Set<string>()

    for (const key of this.keys()) {
      if (!key.startsWith(KEY_PREFIX)) continue
      const rest = key.slice(KEY_PREFIX.length)
      const separator = rest.lastIndexOf(':')
      if (separator <= 0) continue
      try {
        symbols.add(Instrument.from(rest.slice(0, separator)).toString())
      } catch {
        // Clave con nuestro prefijo pero símbolo inválido: no es datos de velas.
      }
    }

    return [...symbols].map((symbol) => Instrument.from(symbol)).sort(bySymbol)
  }

  /** Elimina todas las claves de velas (solo las nuestras). */
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

  private read(key: string): Candle[] {
    const raw = this.storage.getItem(key)
    if (raw === null) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new CorruptedStorageError('el JSON no es válido', key, error)
    }

    if (!Array.isArray(parsed)) {
      throw new CorruptedStorageError('se esperaba un array de velas', key, parsed)
    }

    try {
      return parsed.map((item) => Candle.from(item))
    } catch (error) {
      throw new CorruptedStorageError('el array contiene velas inválidas', key, error)
    }
  }
}
