import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from '@/components/App'
import { BinanceProvider, type FetchLike } from '@/api/binanceProvider'
import type { MarketDataProvider } from '@/api/marketDataProvider'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { StrategyRepository } from '@/storage/strategyRepository'
import type { StrategySpec } from '@/domain/strategies/spec'

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
let experiments: ExperimentRepository
let strategies: StrategyRepository
let uiStorage: MemoryStorage

/** Estrategia sma-cross(2/3): la misma que los E2E (cruces en i4/i7). */
const SPEC: StrategySpec = {
  name: 'sma-cross',
  version: 1,
  indicators: [
    { alias: 'fast', kind: 'sma', period: 2 },
    { alias: 'slow', kind: 'sma', period: 3 },
  ],
  entry: {
    rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
    execution: 'market',
  },
  exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
}

/** Segunda estrategia para el selector único (§1.9). */
const ALPHA_SPEC: StrategySpec = {
  name: 'alpha',
  version: 1,
  indicators: [{ alias: 'fast', kind: 'sma', period: 5 }],
  entry: {
    rule: { kind: 'condition', op: '>', a: 'close', b: 'fast' },
    execution: 'market',
  },
  exitRule: { kind: 'condition', op: '<', a: 'close', b: 'fast' },
}

function renderApp(provider?: MarketDataProvider) {
  const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () =>
    jsonResponse([kline(1_700_000_000_000)]),
  )
  const marketProvider =
    provider ?? new BinanceProvider({ fetch: fetchImpl as unknown as FetchLike })
  const utils = render(
    <App
      repository={repository}
      provider={marketProvider}
      experiments={experiments}
      strategies={strategies}
      uiStorage={uiStorage}
    />,
  )
  return { fetchImpl, unmount: utils.unmount }
}

/** Panel de backtest (hay dos formularios con los mismos labels en la pantalla). */
function backtestPanel() {
  return within(screen.getByRole('region', { name: 'Backtest' }))
}

/** Abre una sección del acordeón del sidebar (por defecto solo "Datos" está abierta). */
function openSection(name: 'Datos' | 'Experimentos') {
  const header = screen.getByRole('button', { name })
  if (header.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(header)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
  repository = new CandleRepository(new MemoryStorage())
  experiments = new ExperimentRepository(new MemoryStorage())
  strategies = new StrategyRepository(new MemoryStorage())
  strategies.save(SPEC)
  uiStorage = new MemoryStorage()
})

describe('App', () => {
  it('muestra el estado vacío cuando no hay datos guardados', () => {
    renderApp()

    expect(screen.getByTestId('chart-empty')).toHaveTextContent('Sin datos para mostrar')
    expect(screen.queryByTestId('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('chart-instrument')).toHaveTextContent('BTC/USDT · 1h')
    expect(screen.getByText('sin datos')).toBeInTheDocument()
  })

  it('agrupa los formularios en tres secciones colapsables del sidebar', () => {
    renderApp()

    const datos = screen.getByRole('button', { name: 'Datos' })
    const experimentos = screen.getByRole('button', { name: 'Experimentos' })
    const estrategias = screen.getByRole('button', { name: 'Estrategias' })

    // Por defecto solo "Datos" está abierta; no existe sección "Resultados"
    // (Historial es una pestaña desde la Fase 3).
    expect(datos).toHaveAttribute('aria-expanded', 'true')
    expect(experimentos).toHaveAttribute('aria-expanded', 'false')
    expect(estrategias).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Resultados' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ejecutar backtest' })).not.toBeInTheDocument()

    // Acordeón: abrir otra sección cierra la anterior.
    fireEvent.click(experimentos)
    expect(datos).toHaveAttribute('aria-expanded', 'false')
    expect(experimentos).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Ejecutar backtest' })).toBeInTheDocument()

    // La tercera sección (CRUD de estrategias, §1.8) abre el editor/lista.
    fireEvent.click(estrategias)
    expect(experimentos).toHaveAttribute('aria-expanded', 'false')
    expect(estrategias).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Nueva estrategia' })).toBeInTheDocument()

    // Y la sección abierta se puede cerrar del todo.
    fireEvent.click(estrategias)
    expect(estrategias).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Nueva estrategia' })).not.toBeInTheDocument()
  })

  it('permite alternar entre las seis pestañas del área principal', () => {
    renderApp()

    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()

    // Backtest: estado vacío; el gráfico deja de estar montado.
    fireEvent.click(screen.getByRole('tab', { name: 'Backtest' }))
    expect(screen.getByRole('tab', { name: 'Backtest' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('backtest-results-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()

    // Replay: controles + gráfico juntos en la misma pestaña.
    fireEvent.click(screen.getByRole('tab', { name: 'Replay' }))
    expect(screen.getByRole('region', { name: 'Replay' })).toBeVisible()
    expect(screen.getByTestId('replay-empty')).toBeVisible()
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()

    // Test-Forward y Optimización: estado vacío (sin sesión / sin resultados).
    fireEvent.click(screen.getByRole('tab', { name: 'Test-Forward' }))
    expect(screen.getByTestId('tf-session-empty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Optimización' }))
    expect(screen.getByTestId('opt-results-empty')).toBeInTheDocument()

    // Historial: el panel completo (siempre montado; visible al activar la pestaña).
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
    expect(screen.getByTestId('history-empty')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Borrar todo' })).toBeInTheDocument()

    // Vuelta al gráfico.
    fireEvent.click(screen.getByRole('tab', { name: 'Gráfico' }))
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('backtest-results-empty')).not.toBeInTheDocument()
  })

  it('persiste la sección abierta del sidebar en el storage de UI', () => {
    const first = renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Experimentos' }))
    expect(screen.getByRole('button', { name: 'Experimentos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    first.unmount()
    renderApp()

    expect(screen.getByRole('button', { name: 'Experimentos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('incluye el panel de backtest (deshabilitado sin datos)', () => {
    renderApp()
    openSection('Experimentos')

    expect(backtestPanel().getByLabelText('Capital inicial')).toHaveValue(1_000)
    expect(screen.getByRole('button', { name: 'Ejecutar backtest' })).toBeDisabled()
  })

  it('un único selector de estrategia comparte la selección con todos los paneles (§1.9)', () => {
    strategies.save(ALPHA_SPEC)
    const smaId = strategies.save(SPEC)
    renderApp()
    openSection('Experimentos')

    const select = screen.getByRole('combobox', { name: 'Estrategia' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'alpha@1', // orden name ascendente → la primera es la selección inicial
      'sma-cross@1',
    ])
    const tf = within(screen.getByRole('region', { name: 'Test-Forward' }))
    expect(backtestPanel().getByTestId('backtest-strategy-hint')).toHaveTextContent('alpha@1')
    expect(tf.getByTestId('tf-strategy-hint')).toHaveTextContent('alpha@1')

    // Cambiar la selección actualiza TODOS los paneles a la vez.
    fireEvent.change(select, { target: { value: smaId } })
    expect(backtestPanel().getByTestId('backtest-strategy-hint')).toHaveTextContent('sma-cross@1')
    expect(tf.getByTestId('tf-strategy-hint')).toHaveTextContent('sma-cross@1')
    expect(screen.queryByTestId('opt-no-params')).not.toBeInTheDocument()
  })

  it('incluye la pestaña Replay (controles sin datos) y el subtítulo de la fase', () => {
    renderApp()
    fireEvent.click(screen.getByRole('tab', { name: 'Replay' }))

    expect(screen.getByRole('region', { name: 'Replay' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
    expect(screen.getByTestId('replay-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByText(/Fase 6/)).toBeInTheDocument()
  })

  it('incluye los paneles de la Fase 6 (historial, test-forward y optimización)', () => {
    renderApp()
    openSection('Experimentos')

    // Formularios en la sidebar…
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()

    // …y el historial completo en su pestaña (sección Resultados eliminada).
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))

    expect(screen.getByTestId('history-empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Borrar todo' })).toBeDisabled()
  })

  it('ejecutar un backtest lo auto-guarda en el historial', () => {
    const closes = [100, 100, 100, 90, 130, 130, 130, 100, 100]
    repository.save(
      Instrument.of('BTC', 'USDT'),
      Timeframe.HOUR,
      closes.map((close, index) => candle(1_700_000_000_000 + index * 3_600_000, close)),
    )
    renderApp()
    openSection('Experimentos')

    expect(screen.queryByTestId('history-table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    const history = screen.getByTestId('history-table')
    expect(history).toHaveTextContent('sma-cross@1')
    expect(history).toHaveTextContent('BTC/USDT')
    expect(history).toHaveTextContent('1h')
    // y el snapshot quedó en el repositorio inyectado
    expect(experiments.list()).toHaveLength(1)
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
    openSection('Experimentos')
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    // Auto-conmutación (plan UI): los resultados abren su pestaña en el área principal.
    expect(screen.getByRole('tab', { name: 'Backtest' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('backtest-summary')).toHaveTextContent('sma-cross@1')
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('Beneficio neto')
    expect(screen.getByTestId('backtest-trades')).toBeInTheDocument()
  })

  it('iniciar un test-forward corta el gráfico y abre su pestaña (§2.3)', () => {
    const closes = [100, 100, 100, 90, 130, 130, 130, 100, 100]
    repository.save(
      Instrument.of('BTC', 'USDT'),
      Timeframe.HOUR,
      closes.map((close, index) => candle(1_700_000_000_000 + index * 3_600_000, close)),
    )
    renderApp()
    openSection('Experimentos')

    // Hay dos formularios con los mismos labels: acotar al panel Test-Forward.
    const tf = within(screen.getByRole('region', { name: 'Test-Forward' }))
    fireEvent.click(tf.getByRole('button', { name: 'Iniciar sesión' }))

    // Auto-conmutación a la pestaña con la sesión viva y el gráfico cortado.
    expect(screen.getByRole('tab', { name: 'Test-Forward' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('tf-progress')).toHaveTextContent('5 / 9 velas')
    expect(screen.getByTestId('tf-decision')).toHaveTextContent('Entrada')
    expect(screen.getByText('5/9 velas')).toBeInTheDocument() // rango del gráfico (anti look-ahead)

    // La sesión NO genera ExperimentSnapshot (riesgo §: decisiones humanas + RNG).
    expect(experiments.list()).toHaveLength(0)
  })

  it('ejecutar una optimización muestra sus resultados en su pestaña', () => {
    const closes = [100, 100, 100, 90, 130, 130, 130, 100, 100]
    repository.save(
      Instrument.of('BTC', 'USDT'),
      Timeframe.HOUR,
      closes.map((close, index) => candle(1_700_000_000_000 + index * 3_600_000, close)),
    )
    renderApp()
    openSection('Experimentos')

    // Rejilla por defecto centrada en la spec (6 × 7 = 42 combinaciones) sobre las 9 velas.
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar optimización' }))

    expect(screen.getByRole('tab', { name: 'Optimización' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('opt-runs')).toBeInTheDocument()
  })

  it('recorta el gráfico a las velas consumidas durante el replay', () => {
    const closes = [100, 100, 100, 90, 130, 130, 130, 100, 100]
    repository.save(
      Instrument.of('BTC', 'USDT'),
      Timeframe.HOUR,
      closes.map((close, index) => candle(1_700_000_000_000 + index * 3_600_000, close)),
    )
    renderApp()
    fireEvent.click(screen.getByRole('tab', { name: 'Replay' }))

    expect(screen.getByText('9 velas')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()

    // Sesión iniciada: cursor 0 → el gráfico (y sus líneas) no ven nada aún.
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(screen.getByText('0/9 velas')).toBeInTheDocument()
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()

    // Un paso → exactamente una vela visible (sin look-ahead en la UI).
    fireEvent.click(screen.getByRole('button', { name: 'Paso' }))
    expect(screen.getByText('1/9 velas')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()
    expect(screen.queryByText('9 velas')).not.toBeInTheDocument()
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
