import { DomainError, formatValue } from '@/domain/errors'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

/** Rango temporal de una consulta de velas (timestamps Unix en ms, límites inclusivos). */
export interface TimeRange {
  from?: number
  to?: number
}

/** Error de un proveedor de datos: red caída, HTTP de error o cuerpo inesperado. */
export class MarketDataError extends DomainError {
  constructor(reason: string, detail?: unknown) {
    super(
      'MarketDataError',
      detail !== undefined ? `${reason} (recibido: ${formatValue(detail)})` : reason,
    )
  }
}

/** Contrato de proveedor de datos: los subsistemas no dependen de un exchange concreto. */
export interface MarketDataProvider {
  /** Velas ascendentes; sin `range` las más recientes. Fallos → `MarketDataError`. */
  getCandles(
    instrument: Instrument,
    timeframe: Timeframe,
    range?: TimeRange,
  ): Promise<readonly Candle[]>
}
