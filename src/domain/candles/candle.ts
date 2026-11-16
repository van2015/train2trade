import { DomainError, invalidMessage } from '@/domain/errors'
import { assertFinitePrice, LevelPosition, PricePosition } from '@/domain/candles/pricePosition'

export interface CandleFields {
  /** Timestamp en milisegundos (UTC) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export class InvalidCandlesError extends DomainError {
  constructor(reason: string, raw: unknown) {
    super('InvalidCandlesError', invalidMessage('Velas inválidas', reason, raw))
  }
}

/**
 * Value object inmutable OHLCV. Los invariantes (campos finitos, `high >= low`)
 * los garantiza `Candle.from`.
 */
export class Candle {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number

  private constructor(fields: CandleFields) {
    this.time = fields.time
    this.open = fields.open
    this.high = fields.high
    this.low = fields.low
    this.close = fields.close
    this.volume = fields.volume
  }

  /** Construye validando invariantes (acepta strings numéricos). Idempotente sobre instancias. */
  static from(value: unknown): Candle {
    if (value instanceof Candle) return value
    if (value === null || typeof value !== 'object') {
      throw new InvalidCandlesError('se esperaba un objeto de velas', value)
    }
    return new Candle(Candle.toCandleFields(value))
  }

  /** Campos extraídos y validados de un objeto crudo: números finitos y `high >= low`. */
  private static toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }

  private static toCandleFields(value: object): CandleFields {
    const record = value as Record<string, unknown>
    const fields = {
      time: this.toFiniteNumber(record.time),
      open: this.toFiniteNumber(record.open),
      high: this.toFiniteNumber(record.high),
      low: this.toFiniteNumber(record.low),
      close: this.toFiniteNumber(record.close),
      volume: this.toFiniteNumber(record.volume),
    } as Record<keyof CandleFields, number | null>

    for (const key of ['time', 'open', 'high', 'low', 'close', 'volume'] as const) {
      if (fields[key] === null) {
        throw new InvalidCandlesError(`el campo "${key}" no es un número finito`, record[key])
      }
    }

    const candles = fields as unknown as CandleFields
    if (candles.high < candles.low) {
      throw new InvalidCandlesError(
        `"high" (${candles.high}) es menor que "low" (${candles.low})`,
        value,
      )
    }

    return candles
  }

  get isBullish(): boolean {
    return this.close > this.open
  }

  get isBearish(): boolean {
    return this.close < this.open
  }

  get bodySize(): number {
    return Math.abs(this.close - this.open)
  }

  get range(): number {
    return this.high - this.low
  }

  /** Dónde cae `price` respecto a la vela (cuerpo cerrado). */
  positionOf(price: number): PricePosition {
    assertFinitePrice(price)

    const bodyTop = Math.max(this.open, this.close)
    const bodyBottom = Math.min(this.open, this.close)

    if (price > this.high) return PricePosition.Above
    if (price < this.low) return PricePosition.Below
    if (price < bodyBottom) return PricePosition.LowerWick
    if (price <= bodyTop) return PricePosition.Body
    return PricePosition.UpperWick
  }

  /** true si `price` cae dentro de [low, high] (bordes incluidos). */
  contains(price: number): boolean {
    const position = this.positionOf(price)
    return (
      position === PricePosition.Body ||
      position === PricePosition.UpperWick ||
      position === PricePosition.LowerWick
    )
  }

  closePosition(price: number): LevelPosition {
    return this.levelPositionOf(this.close, price)
  }

  openPosition(price: number): LevelPosition {
    return this.levelPositionOf(this.open, price)
  }

  closesAbove(price: number): boolean {
    return this.closePosition(price) === LevelPosition.Above
  }

  closesAt(price: number): boolean {
    return this.closePosition(price) === LevelPosition.At
  }

  closesBelow(price: number): boolean {
    return this.closePosition(price) === LevelPosition.Below
  }

  opensAbove(price: number): boolean {
    return this.openPosition(price) === LevelPosition.Above
  }

  opensAt(price: number): boolean {
    return this.openPosition(price) === LevelPosition.At
  }

  opensBelow(price: number): boolean {
    return this.openPosition(price) === LevelPosition.Below
  }

  equals(other: Candle): boolean {
    return (
      this === other ||
      (this.time === other.time &&
        this.open === other.open &&
        this.high === other.high &&
        this.low === other.low &&
        this.close === other.close &&
        this.volume === other.volume)
    )
  }

  toJSON(): CandleFields {
    return {
      time: this.time,
      open: this.open,
      high: this.high,
      low: this.low,
      close: this.close,
      volume: this.volume,
    }
  }

  private levelPositionOf(value: number, level: number): LevelPosition {
    assertFinitePrice(level)
    if (value > level) return LevelPosition.Above
    if (value === level) return LevelPosition.At
    return LevelPosition.Below
  }
}
