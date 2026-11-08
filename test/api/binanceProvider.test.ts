import { describe, expect, it, vi } from 'vitest'
import { BinanceProvider, type FetchLike } from '@/api/binanceProvider'
import { MAX_CANDLES } from '@/api/candleRequest'
import { MarketDataError } from '@/api/marketDataProvider'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

const BTC_USDT = Instrument.of('BTC', 'USDT')

/** Fila de `/api/v3/klines`: [openTime, open, high, low, close, volume, ...]. */
function kline(
  openTime: number,
  open = '100',
  high = '110',
  low = '90',
  close = '105',
  volume = '42',
) {
  return [openTime, open, high, low, close, volume, openTime + 3_599_999, '0', 1, '0', '0', '0']
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function providerWith(fetchImpl: FetchLike): BinanceProvider {
  return new BinanceProvider({ fetch: fetchImpl, baseUrl: 'https://exchange.test' })
}

function urlOf(fetchImpl: FetchLike): string {
  const calls = vi.mocked(fetchImpl).mock.calls
  expect(calls).toHaveLength(1)
  return String(calls[0]?.[0])
}

describe('BinanceProvider', () => {
  it('sin rango pide las velas más recientes con el límite máximo', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([kline(1_000_000)]))
    const provider = providerWith(fetchImpl)

    const candles = await provider.getCandles(BTC_USDT, Timeframe.HOUR)

    const url = new URL(urlOf(fetchImpl))
    expect(url.origin).toBe('https://exchange.test')
    expect(url.pathname).toBe('/api/v3/klines')
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT')
    expect(url.searchParams.get('interval')).toBe('1h')
    expect(url.searchParams.get('limit')).toBe(String(MAX_CANDLES))
    expect(url.searchParams.has('startTime')).toBe(false)
    expect(url.searchParams.has('endTime')).toBe(false)
    expect(candles).toHaveLength(1)
  })

  it('convierte las filas de klines en velas validadas y ascendentes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        kline(3_000, '300', '310', '290', '305'),
        kline(1_000, '100'),
        kline(2_000, '200'),
      ]),
    )
    const provider = providerWith(fetchImpl)

    const candles = await provider.getCandles(BTC_USDT, Timeframe.HOUR)

    expect(candles.map((candle) => candle.time)).toEqual([1_000, 2_000, 3_000])
    expect(candles[1]?.open).toBe(200)
    expect(candles[2]?.close).toBe(305)
    expect(candles[2]?.volume).toBe(42)
  })

  it('con un rango envía startTime, endTime y el límite calculado', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const provider = providerWith(fetchImpl)

    // 00:00 → 04:00 en 1h = 5 velas
    await provider.getCandles(BTC_USDT, Timeframe.HOUR, { from: 0, to: 4 * Timeframe.HOUR.ms })

    const url = new URL(urlOf(fetchImpl))
    expect(url.searchParams.get('startTime')).toBe('0')
    expect(url.searchParams.get('endTime')).toBe(String(4 * Timeframe.HOUR.ms))
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('admite un rango abierto por la izquierda o por la derecha', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const provider = providerWith(fetchImpl)

    await provider.getCandles(BTC_USDT, Timeframe.DAY, { to: 5_000 })
    expect(new URL(urlOf(fetchImpl)).searchParams.get('endTime')).toBe('5000')
    expect(new URL(urlOf(fetchImpl)).searchParams.get('limit')).toBe(String(MAX_CANDLES))

    fetchImpl.mockClear()
    await provider.getCandles(BTC_USDT, Timeframe.DAY, { from: 1_000 })
    expect(new URL(urlOf(fetchImpl)).searchParams.get('startTime')).toBe('1000')
    expect(new URL(urlOf(fetchImpl)).searchParams.get('endTime')).toBeNull()
    expect(new URL(urlOf(fetchImpl)).searchParams.get('limit')).toBe(String(MAX_CANDLES))
  })

  it('rechaza un rango invertido antes de salir a la red', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const provider = providerWith(fetchImpl)

    await expect(
      provider.getCandles(BTC_USDT, Timeframe.HOUR, { from: 5_000, to: 1_000 }),
    ).rejects.toThrow(RangeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('lanza MarketDataError ante un error HTTP con el mensaje del exchange', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400))
    const provider = providerWith(fetchImpl)

    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(MarketDataError)
    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(/Invalid symbol/)
    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(/400/)
  })

  it('lanza MarketDataError si la red falla', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const provider = providerWith(fetchImpl)

    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(MarketDataError)
  })

  it('lanza MarketDataError si la respuesta no es un array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unexpected' }))
    const provider = providerWith(fetchImpl)

    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(MarketDataError)
  })

  it('lanza MarketDataError si ninguna fila del array es una vela válida', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([['nope'], ['nope']]))
    const provider = providerWith(fetchImpl)

    await expect(provider.getCandles(BTC_USDT, Timeframe.HOUR)).rejects.toThrow(MarketDataError)
  })

  it('descarta filas inválidas puntuales sin abortar la consulta', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([['bad'], kline(1_000)]))
    const provider = providerWith(fetchImpl)

    const candles = await provider.getCandles(BTC_USDT, Timeframe.HOUR)

    expect(candles).toHaveLength(1)
    expect(candles[0]?.time).toBe(1_000)
  })

  it('el nombre del error permite identificarlo en la UI', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('boom')
    })

    try {
      await providerWith(fetchImpl).getCandles(BTC_USDT, Timeframe.HOUR)
      expect.unreachable('debió lanzar')
    } catch (error) {
      expect((error as MarketDataError).name).toBe('MarketDataError')
    }
  })
})
