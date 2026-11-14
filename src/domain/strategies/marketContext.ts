import { DomainError, invalidMessage } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'

export interface MarketContextData {
  /** Velas visibles hasta el instante de evaluación, orden ascendente, sin duplicados. */
  candles: readonly Candle[]
  /** Series de indicadores alineadas por índice con `candles`; clave = alias declarado por la estrategia. */
  indicators?: Readonly<Record<string, readonly IndicatorValue[]>>
  /** Niveles de operación (entry/sl/tp); ver `OperationLevels`. */
  levels?: OperationLevels
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
 * Alias de operación (decisión 10): `entry` = precio de relleno de la posición;
 * `sl`/`tp` = niveles efectivos actuales (override de sesión ?? expresión de la
 * estrategia). `undefined` = automático (la estrategia lo calcula), `null` =
 * sin posición / desactivado, número = valor efectivo. No tienen histórico
 * (`back > 0` → `null`).
 */
export interface OperationLevels {
  entry?: number | null
  sl?: number | null
  tp?: number | null
}

/**
 * Información disponible para evaluar una estrategia: solo velas visibles,
 * nunca futuras (§12B). Invariantes y congelado se garantizan en `from`.
 */
export class MarketContext {
  private readonly visibleCandles: readonly Candle[]
  private readonly series: Readonly<Record<string, readonly IndicatorValue[]>>
  private readonly levelsValue: OperationLevels

  private constructor(
    candles: readonly Candle[],
    series: Readonly<Record<string, readonly IndicatorValue[]>>,
    levels: OperationLevels,
  ) {
    this.visibleCandles = candles
    this.series = series
    this.levelsValue = levels
  }

  /** Construye validando invariantes; idempotente sobre un contexto ya construido. */
  static from(data: MarketContextData | MarketContext): MarketContext {
    if (data instanceof MarketContext) return data

    const { candles, indicators, levels } = data
    validateCandles(candles)
    return new MarketContext(
      Object.freeze([...candles]),
      buildFrozenSeries(indicators, candles),
      freezeLevels(validateLevels(levels)),
    )
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

  /** Niveles de operación actuales (congelados). */
  get levels(): OperationLevels {
    return this.levelsValue
  }

  /**
   * Contexto derivado con otros niveles (fusiona sobre los actuales): comparte
   * velas y series (sin recalcular), solo cambia `levels`. Usado por el runner
   * para inyectar `entry`/overrides y por `Strategy.evaluate` para materializar
   * los niveles efectivos antes de evaluar reglas y triggers.
   */
  withLevels(levels: OperationLevels): MarketContext {
    return new MarketContext(
      this.visibleCandles,
      this.series,
      freezeLevels(validateLevels({ ...this.levelsValue, ...levels })),
    )
  }

  /** Valor del indicador `id` hace `back` velas (0 = actual); `null` en calentamiento. */
  value(id: string, back = 0): number | null {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }

    const index = this.visibleCandles.length - 1 - back
    const series = this.series[id]
    // El alias registrado tiene prioridad sobre el de operación y el builtin.
    if (series !== undefined) {
      if (index < 0) return null
      return series[index]?.value ?? null
    }

    // Alias de operación (entry/sl/tp): solo valor actual, sin histórico.
    if (id === 'entry' || id === 'sl' || id === 'tp') {
      if (back > 0) return null
      return this.levelsValue[id] ?? null
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

/** Valida los niveles: cada valor debe ser `null` o un número finito (o ausente). */
function validateLevels(levels: OperationLevels | undefined): OperationLevels {
  if (levels === undefined) return {}
  if (!isRecord(levels)) {
    throw new MarketContextError('levels debe ser un objeto', levels)
  }

  for (const key of ['entry', 'sl', 'tp'] as const) {
    const value = levels[key]
    if (value === undefined || value === null) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new MarketContextError(`levels.${key} debe ser null o un número finito`, value)
    }
  }
  return levels
}

function freezeLevels(levels: OperationLevels): OperationLevels {
  return Object.freeze({ ...levels })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
