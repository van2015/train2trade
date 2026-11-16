import { DomainError, formatValue } from '@/domain/errors'

const TIMEFRAME_CODES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const

export type TimeframeCode = (typeof TIMEFRAME_CODES)[number]

const TIMEFRAME_MS: Record<TimeframeCode, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}

export class InvalidTimeframeError extends DomainError {
  constructor(value: unknown) {
    super(
      'InvalidTimeframeError',
      `Timeframe no soportado: ${formatValue(value)}. Usa uno de ${TIMEFRAME_CODES.join(', ')}`,
    )
  }
}

/** Timeframe soportado. Internado: `Timeframe.from('1h') === Timeframe.HOUR`. */
export class Timeframe {
  static readonly MINUTE = new Timeframe('1m')
  static readonly FIVE_MINUTES = new Timeframe('5m')
  static readonly FIFTEEN_MINUTES = new Timeframe('15m')
  static readonly HOUR = new Timeframe('1h')
  static readonly FOUR_HOURS = new Timeframe('4h')
  static readonly DAY = new Timeframe('1d')

  static readonly ALL: readonly Timeframe[] = [
    Timeframe.MINUTE,
    Timeframe.FIVE_MINUTES,
    Timeframe.FIFTEEN_MINUTES,
    Timeframe.HOUR,
    Timeframe.FOUR_HOURS,
    Timeframe.DAY,
  ]

  private static readonly BY_CODE = new Map<string, Timeframe>(
    Timeframe.ALL.map((tf): [string, Timeframe] => [tf.code, tf]),
  )

  readonly code: TimeframeCode
  /** Duración del timeframe en milisegundos. */
  readonly ms: number

  private constructor(code: TimeframeCode) {
    this.code = code
    this.ms = TIMEFRAME_MS[code]
  }

  /** Parsea un código (`"1h"`) o devuelve la instancia si ya lo es. Lanza `InvalidTimeframeError`. */
  static from(value: unknown): Timeframe {
    if (value instanceof Timeframe) return value
    if (typeof value === 'string') {
      const timeframe = Timeframe.BY_CODE.get(value)
      if (timeframe !== undefined) return timeframe
    }
    throw new InvalidTimeframeError(value)
  }

  static is(value: unknown): value is Timeframe {
    return value instanceof Timeframe
  }

  /** true si el valor es un código soportado (validación sin lanzar, p. ej. en formularios). */
  static isCode(value: unknown): value is TimeframeCode {
    return typeof value === 'string' && Timeframe.BY_CODE.has(value)
  }

  equals(other: Timeframe): boolean {
    return this === other
  }

  toString(): string {
    return this.code
  }

  toJSON(): string {
    return this.code
  }
}
