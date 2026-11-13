import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'

export interface MarketContextData {
  /** Velas visibles hasta el instante de evaluación, orden ascendente, sin duplicados. */
  candles: readonly Candle[]
  /** Series de indicadores alineadas por índice con `candles`; clave = alias declarado por la estrategia. */
  indicators?: Readonly<Record<string, readonly IndicatorValue[]>>
}

export class MarketContextError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('MarketContextError', invalidMessage('Contexto de mercado inválido', reason, raw))
  }
}

/** Campos builtin de la vela actual, resolubles como serie sin declarar indicador. */
export type BuiltinField = 'open' | 'high' | 'low' | 'close'

const BUILTIN_FIELDS: readonly BuiltinField[] = ['open', 'high', 'low', 'close']

/**
 * Información disponible para evaluar una estrategia: solo velas visibles,
 * nunca futuras (§12B). Invariantes y congelado se garantizan en `from`.
 */
export class MarketContext {
  private readonly visibleCandles: readonly Candle[]
  private readonly series: Readonly<Record<string, readonly IndicatorValue[]>>

  private constructor(
    candles: readonly Candle[],
    series: Readonly<Record<string, readonly IndicatorValue[]>>,
  ) {
    this.visibleCandles = candles
    this.series = series
  }

  /** Construye validando invariantes; idempotente sobre un contexto ya construido. */
  static from(data: MarketContextData | MarketContext): MarketContext {
    if (data instanceof MarketContext) return data

    const { candles, indicators } = data
    validateCandles(candles)
    return new MarketContext(Object.freeze([...candles]), buildFrozenSeries(indicators, candles))
  }

  /** Timestamp de la vela actual (ms UTC). */
  get time(): number {
    return this.current.time
  }

  get current(): Candle {
    const last = this.visibleCandles[this.visibleCandles.length - 1]
    if (last === undefined) {
      throw new MarketContextError('el contexto no tiene velas visibles')
    }
    return last
  }

  get previous(): Candle | undefined {
    return this.visibleCandles[this.visibleCandles.length - 2]
  }

  get length(): number {
    return this.visibleCandles.length
  }

  get candles(): readonly Candle[] {
    return this.visibleCandles
  }

  /** Valor del indicador `id` hace `back` velas (0 = actual); `null` en calentamiento. */
  value(id: string, back = 0): number | null {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }

    const index = this.visibleCandles.length - 1 - back
    const series = this.series[id]
    // El alias registrado tiene prioridad sobre la serie builtin.
    if (series !== undefined) {
      if (index < 0) return null
      return series[index]?.value ?? null
    }

    // Series builtin de la vela actual (close/open/high/low): clase `price`.
    if (BUILTIN_FIELDS.includes(id as BuiltinField)) {
      if (index < 0) return null
      const candle = this.visibleCandles[index]
      if (candle === undefined) return null
      return candle[id as BuiltinField]
    }

    throw new MarketContextError('el indicador no está registrado', id)
  }
}

function validateCandles(candles: readonly Candle[]): void {
  if (candles.length === 0) {
    throw new MarketContextError('se necesita al menos una vela', candles)
  }

  let previousTime = Number.NEGATIVE_INFINITY
  for (const candle of candles) {
    if (candle.time <= previousTime) {
      throw new MarketContextError(
        candle.time === previousTime
          ? 'las velas tienen time duplicado'
          : 'las velas están fuera de orden (deben ser ascendentes por time)',
        candle.time,
      )
    }
    previousTime = candle.time
  }
}

function buildFrozenSeries(
  indicators: Readonly<Record<string, readonly IndicatorValue[]>> | undefined,
  candles: readonly Candle[],
): Readonly<Record<string, readonly IndicatorValue[]>> {
  const frozen: Record<string, readonly IndicatorValue[]> = Object.assign(
    Object.create(null) as Record<string, readonly IndicatorValue[]>,
  )

  for (const [id, series] of Object.entries(indicators ?? {})) {
    if (series.length !== candles.length) {
      throw new MarketContextError(
        `la serie "${id}" tiene ${series.length} valores y hay ${candles.length} velas`,
        series.length,
      )
    }
    for (let index = 0; index < series.length; index += 1) {
      const entry = series[index]
      const candle = candles[index]
      if (entry === undefined || candle === undefined || entry.time !== candle.time) {
        throw new MarketContextError(
          `la serie "${id}" no está alineada con las velas en el índice ${index}`,
          entry?.time,
        )
      }
    }
    frozen[id] = Object.freeze([...series])
  }

  return Object.freeze(frozen)
}
