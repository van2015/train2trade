import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

/** Rango temporal de una consulta de velas (timestamps Unix en ms, límites inclusivos). */
export interface TimeRange {
  from?: number
  to?: number
}

/** Error de un proveedor de datos: red caída, HTTP de error o cuerpo inesperado. */
export class MarketDataError extends Error {
  constructor(reason: string, detail?: unknown) {
    super(detail !== undefined ? `${reason} (recibido: ${formatValue(detail)})` : reason)
    this.name = 'MarketDataError'
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'un array'
  if (typeof value === 'object') return 'un objeto'
  return String(value)
}

/**
 * Contrato de un proveedor de datos de mercado. Los subsistemas dependen de esta
 * interfaz, no de un exchange concreto: la implementación puede ser Binance, un CSV, etc.
 */
export interface MarketDataProvider {
  /**
   * Velas ordenadas ascendentes para el instrumento y timeframe dados.
   * Sin `range` devuelve las más recientes; con `range` las del rango indicado.
   * Lanza `MarketDataError` ante fallos de red o respuestas inválidas.
   */
  getCandles(
    instrument: Instrument,
    timeframe: Timeframe,
    range?: TimeRange,
  ): Promise<readonly Candle[]>
}
