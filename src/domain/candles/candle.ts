import { DomainError, invalidMessage } from '@/domain/errors'
import { assertFinitePrice, LevelPosition, PricePosition } from './pricePosition'
import { InvalidTimeframeError, Timeframe } from './timeframe'

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Value object inmutable que representa una vela OHLCV.
 *
 * - Invariantes garantizados por `Candle.from`: campos numéricos finitos y `high >= low`.
 * - Formato wire/persistencia: objeto plano (`toJSON`), revivido con `from()`.
 * - Comportamiento: dirección del cuerpo, tamaño del cuerpo, rango,
 *   construcción de velas agregadas (`Candle.aggregate`) y relación de
 *   un precio con la vela (`positionOf`, `contains`, `closePosition`, ...).
 */
export class Candle {
  /** Timestamp en milisegundos (UTC) */
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

  /**
   * Construye una vela validando invariantes. Acepta strings numéricos (formato de API).
   * Lanza `InvalidCandlesError` si algún campo no es finito, falta o `high < low`.
   * Es idempotente sobre instancias.
   */
  static from(value: unknown): Candle {
    if (value instanceof Candle) return value
    if (value === null || typeof value !== 'object') {
      throw new InvalidCandlesError('se esperaba un objeto de velas', value)
    }

    const record = value as Record<string, unknown>
    const fields = {
      time: toFiniteNumber(record.time),
      open: toFiniteNumber(record.open),
      high: toFiniteNumber(record.high),
      low: toFiniteNumber(record.low),
      close: toFiniteNumber(record.close),
      volume: toFiniteNumber(record.volume),
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

    return new Candle(candles)
  }

  /**
   * Construye la vela que representa un grupo de velas ordenadas en un bucket
   * de `timeframe`: open de la primera, close de la última, extremos del grupo,
   * volumen sumado y `time` al inicio del bucket.
   */
  static aggregate(group: readonly Candle[], timeframe: Timeframe): Candle {
    if (!Timeframe.is(timeframe)) {
      throw new InvalidTimeframeError(timeframe)
    }
    if (group.length === 0) {
      throw new RangeError('No se puede agregar un grupo vacío de velas')
    }

    const sorted = group.length > 1 ? [...group].sort((a, b) => a.time - b.time) : group

    let bucketTime = 0
    let open = 0
    let close = 0
    let high = Number.NEGATIVE_INFINITY
    let low = Number.POSITIVE_INFINITY
    let volume = 0
    let isFirst = true

    for (const candle of sorted) {
      if (isFirst) {
        bucketTime = Math.floor(candle.time / timeframe.ms) * timeframe.ms
        open = candle.open
        isFirst = false
      }
      close = candle.close
      high = Math.max(high, candle.high)
      low = Math.min(low, candle.low)
      volume += candle.volume
    }

    return new Candle({ time: bucketTime, open, high, low, close, volume })
  }

  get isBullish(): boolean {
    return this.close > this.open
  }

  get isBearish(): boolean {
    return this.close < this.open
  }

  /** Tamaño absoluto del cuerpo (|close - open|). */
  get bodySize(): number {
    return Math.abs(this.close - this.open)
  }

  /** Amplitud total de la vela (high - low). */
  get range(): number {
    return this.high - this.low
  }

  /**
   * Dónde cae `price` respecto a la vela. El cuerpo es cerrado: `open`/`close`
   * son `Body`. Lanza `InvalidPriceError` si `price` no es un número finito.
   */
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
    return levelPositionOf(this.close, price)
  }

  openPosition(price: number): LevelPosition {
    return levelPositionOf(this.open, price)
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
}

function levelPositionOf(value: number, level: number): LevelPosition {
  assertFinitePrice(level)
  if (value > level) return LevelPosition.Above
  if (value === level) return LevelPosition.At
  return LevelPosition.Below
}
