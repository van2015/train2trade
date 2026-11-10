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

/**
 * Información disponible para evaluar una estrategia en un instante.
 *
 * - Look-ahead: solo recibe las velas visibles; nunca expone velas futuras.
 * - Invariantes: velas no vacías, estrictamente ascendentes y sin duplicados;
 *   cada serie con la misma longitud y `time` que las velas.
 * - Inmutable: colecciones congeladas.
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

  /** Construye (o devuelve si ya es contexto) validando invariantes. Lanza `MarketContextError`. */
  static from(data: MarketContextData | MarketContext): MarketContext {
    if (data instanceof MarketContext) return data

    const { candles, indicators } = data
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

    const frozenSeries: Record<string, readonly IndicatorValue[]> = Object.assign(
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
      frozenSeries[id] = Object.freeze([...series])
    }

    return new MarketContext(Object.freeze([...candles]), Object.freeze(frozenSeries))
  }

  /** Tiempo de mercado: timestamp de la vela actual (ms UTC). */
  get time(): number {
    return this.current.time
  }

  /** Vela actual (la más reciente visible). */
  get current(): Candle {
    const last = this.visibleCandles[this.visibleCandles.length - 1]
    if (last === undefined) {
      throw new MarketContextError('el contexto no tiene velas visibles')
    }
    return last
  }

  /** Vela anterior; `undefined` si solo hay una. */
  get previous(): Candle | undefined {
    return this.visibleCandles[this.visibleCandles.length - 2]
  }

  /** Número de velas visibles. */
  get length(): number {
    return this.visibleCandles.length
  }

  /** Velas visibles, orden ascendente (congeladas). */
  get candles(): readonly Candle[] {
    return this.visibleCandles
  }

  /**
   * Valor del indicador `id` hace `back` velas (0 = actual, 1 = anterior, …).
   * `null` si la serie aún no tiene dato (calentamiento) o `back` exige ir más allá del inicio.
   * Lanza `MarketContextError` si `id` no está registrado (error de configuración)
   * y `RangeError` si `back` no es un entero >= 0.
   */
  value(id: string, back = 0): number | null {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }

    const series = this.series[id]
    if (series === undefined) {
      throw new MarketContextError('el indicador no está registrado', id)
    }

    const index = this.visibleCandles.length - 1 - back
    if (index < 0) return null
    return series[index]?.value ?? null
  }
}
