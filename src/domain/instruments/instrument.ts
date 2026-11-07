const SYMBOL_PATTERN = /^[A-Z0-9]+$/

export class InvalidInstrumentError extends Error {
  constructor(reason: string, raw: unknown) {
    super(`Instrumento inválido: ${reason} (recibido: ${formatValue(raw)})`)
    this.name = 'InvalidInstrumentError'
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'un array'
  if (typeof value === 'object') return 'un objeto'
  return String(value)
}

/** Normaliza una parte (base o quote): trim + mayúsculas, solo `[A-Z0-9]`. Devuelve `null` si no es válida. */
function normalizePart(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const part = value.trim().toUpperCase()
  return SYMBOL_PATTERN.test(part) ? part : null
}

/**
 * Value object inmutable que representa un par de trading (ej. BTC/USDT).
 *
 * - Invariantes: base y quote no vacías, mayúsculas, alfanuméricas (`[A-Z0-9]`).
 * - Internado: `Instrument.from('BTC/USDT') === Instrument.of('BTC', 'USDT')`.
 * - Formato wire/persistencia: string canónico `"BTC/USDT"` (`toString`/`toJSON`).
 * - `from` es idempotente (acepta instancia, string o `{ base, quote }`).
 * - `exchangeSymbol` da el símbolo sin separador para la capa de datos (`BTCUSDT`).
 */
export class Instrument {
  /** Moneda base, ej. `"BTC"`. */
  readonly base: string
  /** Moneda cotizada, ej. `"USDT"`. */
  readonly quote: string

  private static readonly CACHE = new Map<string, Instrument>()

  private constructor(base: string, quote: string) {
    this.base = base
    this.quote = quote
  }

  /**
   * Construye desde `"BTC/USDT"`, `{ base, quote }` o una instancia (idempotente).
   * Lanza `InvalidInstrumentError` si el valor no tiene forma de par válido.
   */
  static from(value: unknown): Instrument {
    if (value instanceof Instrument) return value

    if (typeof value === 'string') {
      const parts = value.split('/')
      if (parts.length !== 2) {
        throw new InvalidInstrumentError('se esperaba el formato "BASE/QUOTE"', value)
      }
      return Instrument.of(parts[0], parts[1])
    }

    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return Instrument.of(record.base, record.quote)
    }

    throw new InvalidInstrumentError('se esperaba un string "BASE/QUOTE" o { base, quote }', value)
  }

  /** Construye desde las partes ya separadas (normaliza y cachea). Lanza `InvalidInstrumentError`. */
  static of(base: unknown, quote: unknown): Instrument {
    const normalizedBase = normalizePart(base)
    if (normalizedBase === null) {
      throw new InvalidInstrumentError('la base debe ser alfanumérica (letras o dígitos)', base)
    }
    const normalizedQuote = normalizePart(quote)
    if (normalizedQuote === null) {
      throw new InvalidInstrumentError('la quote debe ser alfanumérica (letras o dígitos)', quote)
    }

    const key = `${normalizedBase}/${normalizedQuote}`
    const existing = Instrument.CACHE.get(key)
    if (existing !== undefined) return existing

    const instrument = new Instrument(normalizedBase, normalizedQuote)
    Instrument.CACHE.set(key, instrument)
    return instrument
  }

  static is(value: unknown): value is Instrument {
    return value instanceof Instrument
  }

  /** true si `value` tiene forma de par válido sin lanzar (p. ej. validación en formularios). */
  static isValid(value: unknown): boolean {
    try {
      Instrument.from(value)
      return true
    } catch {
      return false
    }
  }

  /** Símbolo canónico para el exchange, sin separador: `"BTCUSDT"`. */
  get exchangeSymbol(): string {
    return `${this.base}${this.quote}`
  }

  equals(other: Instrument): boolean {
    return this === other || (this.base === other.base && this.quote === other.quote)
  }

  /** `"BTC/USDT"`. */
  toString(): string {
    return `${this.base}/${this.quote}`
  }

  /** `"BTC/USDT"`. */
  toJSON(): string {
    return this.toString()
  }
}
