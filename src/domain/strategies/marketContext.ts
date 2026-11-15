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
  /** Índice de la vela actual dentro de `visibleCandles` (`length - 1` por defecto). */
  private readonly base: number
  /** Prefijo congelado memoizado de una vista desplazada (null = contexto raíz). */
  private displacedPrefix: readonly Candle[] | null = null

  private constructor(
    candles: readonly Candle[],
    series: Readonly<Record<string, readonly IndicatorValue[]>>,
    levels: OperationLevels,
    base: number,
  ) {
    this.visibleCandles = candles
    this.series = series
    this.levelsValue = levels
    this.base = base
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
      candles.length - 1,
    )
  }

  /** Timestamp de la vela actual (ms UTC). */
  get time(): number {
    return this.current.time
  }

  get current(): Candle {
    const current = this.visibleCandles[this.base]
    if (current === undefined) {
      throw new MarketContextError('el contexto no tiene velas visibles')
    }
    return current
  }

  get previous(): Candle | undefined {
    return this.visibleCandles[this.base - 1]
  }

  /** Velas visibles para esta vela actual (`base + 1`). */
  get length(): number {
    return this.base + 1
  }

  /**
   * Ventana de velas hasta la vela actual. En un contexto raíz devuelve el
   * mismo array congelado (compartido); en una vista desplazada, el prefijo
   * congelado memoizado (misma referencia en cada llamada).
   */
  get candles(): readonly Candle[] {
    if (this.base === this.visibleCandles.length - 1) return this.visibleCandles
    if (this.displacedPrefix === null) {
      this.displacedPrefix = Object.freeze(this.visibleCandles.slice(0, this.base + 1))
    }
    return this.displacedPrefix
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
      this.base,
    )
  }

  /**
   * Contexto cuya vela actual es la de hace `back` velas (0 = este contexto).
   * **Solo retrocede**: una vista derivada nunca puede ver el futuro, y las
   * series/velas se comparten (O(1), sin recalcular). Los alias de operación
   * (`entry`/`sl`/`tp`) no tienen histórico → `null` en cualquier vista
   * desplazada. `back` fuera de rango → error (no es un caso de uso, es un
   * error de programación).
   */
  at(back: number): MarketContext {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }
    if (back > this.base) {
      throw new MarketContextError('at() no puede retroceder más allá de la primera vela', back)
    }
    if (back === 0) return this
    return new MarketContext(this.visibleCandles, this.series, this.levelsValue, this.base - back)
  }

  /** Valor del indicador `id` hace `back` velas (0 = actual); `null` en calentamiento. */
  value(id: string, back = 0): number | null {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }

    const series = this.series[id]
    // El alias registrado tiene prioridad sobre el de operación y el builtin.
    if (series !== undefined) return this.valueFromSeries(series, back)
    if (id === 'entry' || id === 'sl' || id === 'tp') return this.valueFromLevel(id, back)
    if (BUILTIN_FIELDS.includes(id as BuiltinField)) return this.valueFromCandle(id, back)

    throw new MarketContextError('el indicador no está registrado', id)
  }

  /** Serie del alias registrado; fuera de la ventana visible → `null` (calentamiento). */
  private valueFromSeries(series: readonly IndicatorValue[], back: number): number | null {
    const value = series[this.base - back]
    if (value === undefined) return null
    return value.value
  }

  /**
   * Alias de operación (entry/sl/tp): solo valor actual, sin histórico, y
   * solo en la vela real del contexto (una vista desplazada los ve como null).
   */
  private valueFromLevel(id: 'entry' | 'sl' | 'tp', back: number): number | null {
    if (back > 0 || this.base !== this.visibleCandles.length - 1) return null
    return this.levelsValue[id] ?? null
  }

  /** Series builtin de la vela actual (close/open/high/low): clase `price`. */
  private valueFromCandle(id: string, back: number): number | null {
    const candle = this.visibleCandles[this.base - back]
    if (candle === undefined) return null
    return candle[id as BuiltinField]
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
