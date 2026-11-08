import { Candle } from '@/domain/candles/candle'
import { normalizeCandles } from '@/domain/candles/normalize'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { MAX_CANDLES, candleLimitForRange } from '@/api/candleRequest'
import { MarketDataError, type MarketDataProvider, type TimeRange } from '@/api/marketDataProvider'

const DEFAULT_BASE_URL = 'https://api.binance.com'

/** Abstracción mínima de `fetch` para poder inyectarla en tests. */
export type FetchLike = (url: string) => Promise<Response>

export interface BinanceProviderOptions {
  baseUrl?: string
  fetch?: FetchLike
}

/**
 * Proveedor de velas contra la API pública de Binance (`/api/v3/klines`).
 *
 * - Los códigos de `Timeframe` (1m, 5m, 15m, 1h, 4h, 1d) coinciden con los intervalos
 *   de Binance, así que viajan sin traducción.
 * - Sin `range` devuelve las `MAX_CANDLES` más recientes; con `range` pide exactamente
 *   `candleLimitForRange` velas (nunca más de `MAX_CANDLES` por petición).
 * - Los fallos (red, HTTP, cuerpo inesperado) se envuelven en `MarketDataError`.
 */
export class BinanceProvider implements MarketDataProvider {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: BinanceProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.fetchImpl = options.fetch ?? ((url) => fetch(url))
  }

  async getCandles(
    instrument: Instrument,
    timeframe: Timeframe,
    range?: TimeRange,
  ): Promise<readonly Candle[]> {
    const url = this.buildUrl(instrument, timeframe, range)

    let response: Response
    try {
      response = await this.fetchImpl(url)
    } catch (error) {
      throw new MarketDataError(`No se pudo contactar con el exchange (${this.baseUrl})`, error)
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response)
      const suffix = detail === '' ? '' : `: ${detail}`
      throw new MarketDataError(`El exchange respondió ${response.status}${suffix}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new MarketDataError('La respuesta del exchange no es JSON válido', error)
    }

    if (!Array.isArray(payload)) {
      throw new MarketDataError('Se esperaba un array de velas', payload)
    }

    const candles = normalizeCandles(payload.map(toCandleFields))
    if (candles.length === 0 && payload.length > 0) {
      throw new MarketDataError('La respuesta no contiene velas válidas', payload)
    }
    return candles
  }

  private buildUrl(instrument: Instrument, timeframe: Timeframe, range?: TimeRange): string {
    const from = range?.from
    const to = range?.to
    const limit =
      from !== undefined && to !== undefined
        ? candleLimitForRange(from, to, timeframe)
        : MAX_CANDLES

    const params = new URLSearchParams({
      symbol: instrument.exchangeSymbol,
      interval: timeframe.code,
      limit: String(limit),
    })
    if (from !== undefined) params.set('startTime', String(from))
    if (to !== undefined) params.set('endTime', String(to))

    return `${this.baseUrl}/api/v3/klines?${params.toString()}`
  }
}

/**
 * Mapea una fila de klines (`[openTime, open, high, low, close, volume, ...]`) a campos
 * de vela. Devuelve `null` si la fila no tiene la forma esperada: `normalizeCandles`
 * la descartará igual que descarta cualquier otra vela inválida.
 */
function toCandleFields(row: unknown): unknown {
  if (!Array.isArray(row) || row.length < 6) return null
  const [time, open, high, low, close, volume] = row
  return { time, open, high, low, close, volume }
}

/** Extrae `msg` del cuerpo de error de Binance si existe (best effort). */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body !== null && typeof body === 'object' && 'msg' in body) {
      const message = (body as { msg: unknown }).msg
      if (typeof message === 'string') return message
    }
  } catch {
    // Cuerpo no JSON o ilegible: nos quedamos sin detalle.
  }
  return ''
}
