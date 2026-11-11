import { DomainError, invalidMessage } from '@/domain/errors'

const SYMBOL_PATTERN = /^[A-Z0-9]+$/

export class InvalidInstrumentError extends DomainError {
  constructor(reason: string, raw: unknown) {
    super('InvalidInstrumentError', invalidMessage('Instrumento inválido', reason, raw))
  }
}

/** Trim + mayúsculas, solo `[A-Z0-9]`; `null` si no es válida. */
function normalizePart(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const part = value.trim().toUpperCase()
  return SYMBOL_PATTERN.test(part) ? part : null
}

/**
 * Par de trading inmutable (ej. `BTC/USDT`). Internado: `from('BTC/USDT') ===
 * of('BTC', 'USDT')`. Formato wire: string canónico.
 */
export class Instrument {
  readonly base: string
  readonly quote: string

  private static readonly CACHE = new Map<string, Instrument>()

  private constructor(base: string, quote: string) {
    this.base = base
    this.quote = quote
  }

  /** Desde `"BTC/USDT"`, `{ base, quote }` o una instancia (idempotente). */
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

  /** Desde las partes separadas; normaliza y cachea (internado). */
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

  /** Validación sin lanzar (p. ej. en formularios). */
  static isValid(value: unknown): boolean {
    try {
      Instrument.from(value)
      return true
    } catch {
      return false
    }
  }

  /** Símbolo sin separador para el exchange: `"BTCUSDT"`. */
  get exchangeSymbol(): string {
    return `${this.base}${this.quote}`
  }

  equals(other: Instrument): boolean {
    return this === other || (this.base === other.base && this.quote === other.quote)
  }

  toString(): string {
    return `${this.base}/${this.quote}`
  }

  toJSON(): string {
    return this.toString()
  }
}
