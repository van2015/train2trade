import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '@/components/App'
import { BinanceProvider, type FetchLike } from '@/api/binanceProvider'
import type { MarketDataProvider } from '@/api/marketDataProvider'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository } from '@/storage/candleRepository'

const { chartMock, seriesMock } = vi.hoisted(() => {
  const makeSeries = () => ({
    setData: vi.fn<(data: unknown[]) => void>(),
    applyOptions: vi.fn<(options: unknown) => void>(),
    createPriceLine: vi.fn<(options: unknown) => { removePriceLine: () => void }>(() => ({
      removePriceLine: vi.fn(),
    })),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
  })

  type AddSeriesFn = (
    definition: unknown,
    options?: unknown,
    paneIndex?: number,
  ) => ReturnType<typeof makeSeries>

  const seriesMock = { created: [] as ReturnType<typeof makeSeries>[] }
  const timeScaleMock = { fitContent: vi.fn() }

  const chartMock = {
    addSeries: vi.fn<AddSeriesFn>(() => {
      const series = makeSeries()
      seriesMock.created.push(series)
      return series
    }),
    removeSeries: vi.fn<(series: unknown) => void>(),
    remove: vi.fn(),
    timeScale: vi.fn(() => timeScaleMock),
    timeScaleMock,
    subscribeCrosshairMove: vi.fn<(handler: unknown) => void>(),
    unsubscribeCrosshairMove: vi.fn(),
    addPane: vi.fn(),
    removePane: vi.fn(),
    panes: vi.fn(() => []),
  }

  return { chartMock, seriesMock }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartMock),
  AreaSeries: 'AreaSeries',
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
  CrosshairMode: { Normal: 0, Magnet: 1 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  PriceLineSource: { LastBar: 0, LastValue: 1 },
}))

/** Almacén en memoria para no depender de localStorage entre tests. */
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

function candle(time: number, close = 100): Candle {
  return Candle.from({ time, open: 90, high: 110, low: 80, close, volume: 42 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function kline(openTime: number, close = '105') {
  return [openTime, '100', '110', '90', close, '42', openTime + 3_599_999]
}

let repository: CandleRepository

function renderApp(provider?: MarketDataProvider) {
  const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () =>
    jsonResponse([kline(1_700_000_000_000)]),
  )
  const marketProvider =
    provider ?? new BinanceProvider({ fetch: fetchImpl as unknown as FetchLike })
  render(<App repository={repository} provider={marketProvider} />)
  return { fetchImpl }
}

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
  repository = new CandleRepository(new MemoryStorage())
})

describe('App', () => {
  it('muestra el estado vacío cuando no hay datos guardados', () => {
    renderApp()

    expect(screen.getByTestId('chart-empty')).toHaveTextContent('Sin datos para mostrar')
    expect(screen.queryByTestId('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('chart-instrument')).toHaveTextContent('BTC/USDT · 1h')
    expect(screen.getByText('sin datos')).toBeInTheDocument()
  })

  it('incluye el panel de backtest (deshabilitado sin datos)', () => {
    renderApp()

    expect(screen.getByLabelText('Capital inicial')).toHaveValue(1_000)
    expect(screen.getByRole('button', { name: 'Ejecutar backtest' })).toBeDisabled()
  })

  it('ejecuta un backtest desde la UI con las velas del repositorio', () => {
    // Serie con cruce SMA(2)/SMA(3): sube en i4 y baja en i7 (igual que los E2E).
    const closes = [100, 100, 100, 90, 130, 130, 130, 100, 100]
    repository.save(
      Instrument.of('BTC', 'USDT'),
      Timeframe.HOUR,
      closes.map((close, index) => candle(1_700_000_000_000 + index * 3_600_000, close)),
    )

    renderApp()
    fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('SMA lenta'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-summary')).toHaveTextContent('sma-cross@1')
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('Beneficio neto')
    expect(screen.getByTestId('backtest-trades')).toBeInTheDocument()
  })

  it('carga las velas existentes del repositorio al montar', () => {
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.HOUR, [
      candle(1_700_000_000_000, 42_000),
      candle(1_700_003_600_000, 43_000),
    ])

    renderApp()

    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()
    expect(screen.getByText('2 velas')).toBeInTheDocument()
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('43,000')
  })

  it('recarga las velas al cambiar de timeframe', () => {
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.HOUR, [candle(1_700_000_000_000)])
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.DAY, [
      candle(1_700_000_000_000, 777),
      candle(1_700_086_400_000, 888),
      candle(1_700_172_800_000, 999),
    ])
    renderApp()

    expect(screen.getByText('1 velas')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: '1d' } })

    expect(screen.getByText('3 velas')).toBeInTheDocument()
  })

  it('recarga las velas al cambiar de instrumento', () => {
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.HOUR, [candle(1_700_000_000_000)])
    repository.save(Instrument.of('ETH', 'USDT'), Timeframe.HOUR, [
      candle(1_700_000_000_000, 2_000),
      candle(1_700_003_600_000, 2_100),
    ])
    renderApp()

    fireEvent.change(screen.getByLabelText('Instrumento'), { target: { value: 'ETH/USDT' } })

    expect(screen.getByText('2 velas')).toBeInTheDocument()
    expect(screen.getByTestId('chart-instrument')).toHaveTextContent('ETH/USDT · 1h')
  })

  it('descarga velas del exchange, las guarda y las muestra', async () => {
    const { fetchImpl } = renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('1 velas descargadas'),
    )
    expect(screen.getByText('1 velas')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()

    // Quedan guardadas: un nuevo montaje las ve sin volver a descargar.
    expect(repository.count(Instrument.of('BTC', 'USDT'), Timeframe.HOUR)).toBe(1)
  })

  it('descarga con el rango de fechas indicado', async () => {
    const { fetchImpl } = renderApp()

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2024-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2024-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(url.searchParams.get('startTime')).toBe('1704067200000')
    expect(url.searchParams.get('endTime')).toBe('1706745599999')
  })

  it('muestra el error del exchange sin romper la pantalla', async () => {
    const failing: MarketDataProvider = {
      getCandles: vi.fn(async () => {
        throw new Error('El exchange respondió 400: Invalid symbol.')
      }),
    }
    renderApp(failing)

    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('400'))
    expect(screen.getByTestId('status')).toHaveClass('status--error')
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()
  })

  it('importa un CSV, lo guarda y lo muestra', async () => {
    renderApp()

    const input = screen.getByLabelText('Fichero')
    const file = new File(
      [
        'time,open,high,low,close,volume\n1700000000000,100,110,90,105,42\n1700003600000,105,115,100,110,55',
      ],
      'velas.csv',
      { type: 'text/csv' },
    )
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('2 velas importadas'),
    )
    expect(screen.getByText('2 velas')).toBeInTheDocument()
    expect(repository.count(Instrument.of('BTC', 'USDT'), Timeframe.HOUR)).toBe(2)
  })

  it('muestra el error de un CSV inválido', async () => {
    renderApp()

    const input = screen.getByLabelText('Fichero')
    const file = new File(['timestamp,close\nnope,105'], 'mal.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('no contiene velas válidas'),
    )
    expect(screen.getByTestId('status')).toHaveClass('status--error')
  })

  it('activa los indicadores y dibuja sus series en el gráfico', () => {
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.HOUR, [
      candle(1_700_000_000_000),
      candle(1_700_003_600_000),
    ])
    renderApp()

    // Por defecto solo el SMA está activo: velas, volumen y una línea.
    expect(chartMock.addSeries).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('checkbox', { name: /RSI/ }))

    // Se añade la serie del RSI en el panel inferior (índice 1).
    expect(chartMock.addSeries).toHaveBeenCalledTimes(4)
    expect(chartMock.addSeries.mock.calls[3]?.[2]).toBe(1)
    expect(chartMock.addSeries.mock.calls[3]?.[0]).toBe('LineSeries')
  })

  it('desactiva el indicador y elimina su serie', () => {
    repository.save(Instrument.of('BTC', 'USDT'), Timeframe.HOUR, [candle(1_700_000_000_000)])
    renderApp()

    expect(chartMock.addSeries).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('checkbox', { name: /SMA/ }))

    expect(chartMock.removeSeries).toHaveBeenCalledTimes(1)
  })

  it('refleja el instrumento y timeframe seleccionados en el destino del CSV', () => {
    renderApp()

    expect(screen.getByTestId('csv-target')).toHaveTextContent('BTC/USDT · 1h')

    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: '4h' } })

    expect(screen.getByTestId('csv-target')).toHaveTextContent('BTC/USDT · 4h')
  })
})
