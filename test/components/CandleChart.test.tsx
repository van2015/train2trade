import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Candle } from '@/domain/candles/candle'
import { CandleChart } from '@/components/CandleChart'
import { createChart } from 'lightweight-charts'
import type { ChartLine } from '@/components/chartData'

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

  const seriesMock = {
    make: makeSeries,
    created: [] as ReturnType<typeof makeSeries>[],
  }

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
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
  CrosshairMode: { Normal: 0, Magnet: 1 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  PriceLineSource: { LastBar: 0, LastValue: 1 },
}))

function candle(time: number, close = 100): Candle {
  return Candle.from({ time, open: 90, high: 110, low: 80, close, volume: 42 })
}

function line(overrides: Partial<ChartLine> = {}): ChartLine {
  return {
    id: 'sma',
    label: 'SMA 20',
    color: '#2962ff',
    values: [
      { time: 1_000, value: 95 },
      { time: 2_000, value: 96 },
    ],
    pane: 'price',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
})

describe('CandleChart', () => {
  it('crea el gráfico en el contenedor al montar y lo destruye al desmontar', () => {
    const { unmount } = render(<CandleChart candles={[]} lines={[]} />)

    expect(createChart).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createChart).mock.calls[0]?.[0]).toBeInstanceOf(HTMLDivElement)

    unmount()
    expect(chartMock.remove).toHaveBeenCalledTimes(1)
  })

  it('añade las series de velas y volumen al crear el gráfico', () => {
    render(<CandleChart candles={[]} lines={[]} />)

    expect(chartMock.addSeries).toHaveBeenCalledTimes(2)
    expect(chartMock.addSeries.mock.calls[0]?.[0]).toBe('CandlestickSeries')
    expect(chartMock.addSeries.mock.calls[1]?.[0]).toBe('HistogramSeries')
    // El volumen va en una escala overlay (id vacío) con margen inferior.
    expect(chartMock.addSeries.mock.calls[1]?.[1]).toMatchObject({ priceScaleId: '' })
  })

  it('pasa los datos de velas y volumen a sus series y hace fitContent', () => {
    const candles = [candle(1_000), candle(2_000, 120)]
    render(<CandleChart candles={candles} lines={[]} />)

    const [candleSeries, volumeSeries] = seriesMock.created
    expect(candleSeries?.setData).toHaveBeenCalledWith([
      { time: 1, open: 90, high: 110, low: 80, close: 100 },
      { time: 2, open: 90, high: 110, low: 80, close: 120 },
    ])
    expect(volumeSeries?.setData).toHaveBeenCalledTimes(1)
    expect(volumeSeries?.setData.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ time: 1, value: 42 }),
      expect.objectContaining({ time: 2, value: 42 }),
    ])
    expect(chartMock.timeScaleMock.fitContent).toHaveBeenCalledTimes(1)
  })

  it('actualiza el formato de precio según el último cierre', () => {
    const { rerender } = render(<CandleChart candles={[candle(1_000, 0.0000123)]} lines={[]} />)

    const [candleSeries] = seriesMock.created
    expect(candleSeries?.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
      }),
    )

    rerender(<CandleChart candles={[candle(1_000, 75_000)]} lines={[]} />)
    expect(candleSeries?.applyOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }),
    )
  })

  it('crea una serie por línea de indicador en el panel principal', () => {
    render(<CandleChart candles={[]} lines={[line()]} />)

    // Índices 0 y 1: velas y volumen; el 2 es la línea del indicador.
    expect(chartMock.addSeries).toHaveBeenCalledTimes(3)
    expect(chartMock.addSeries.mock.calls[2]?.[0]).toBe('LineSeries')
    expect(chartMock.addSeries.mock.calls[2]?.[2]).toBe(0)
    expect(seriesMock.created[2]?.setData).toHaveBeenCalledWith([
      { time: 1, value: 95 },
      { time: 2, value: 96 },
    ])
  })

  it('las líneas de panel inferior se añaden al panel 1 con rango fijo', () => {
    render(
      <CandleChart
        candles={[]}
        lines={[
          line({ id: 'rsi', label: 'RSI 14', pane: 'lower', fixedRange: { min: 0, max: 100 } }),
        ]}
      />,
    )

    expect(chartMock.addSeries.mock.calls[2]?.[2]).toBe(1)

    const options = chartMock.addSeries.mock.calls[2]?.[1] as {
      autoscaleInfoProvider: () => { priceRange: { minValue: number; maxValue: number } }
    }
    expect(options.autoscaleInfoProvider()).toEqual({
      priceRange: { minValue: 0, maxValue: 100 },
    })
  })

  it('dibuja las líneas de referencia de un indicador', () => {
    render(
      <CandleChart
        candles={[]}
        lines={[line({ id: 'rsi', pane: 'lower', referenceLines: [30, 70] })]}
      />,
    )

    const lineSeries = seriesMock.created[2]
    expect(lineSeries?.createPriceLine).toHaveBeenCalledTimes(2)
    expect(lineSeries?.createPriceLine.mock.calls[0]?.[0]).toMatchObject({ price: 30 })
    expect(lineSeries?.createPriceLine.mock.calls[1]?.[0]).toMatchObject({ price: 70 })
  })

  it('elimina la serie cuando la línea desaparece de las props', () => {
    const { rerender } = render(<CandleChart candles={[]} lines={[line()]} />)
    expect(chartMock.addSeries).toHaveBeenCalledTimes(3)

    rerender(<CandleChart candles={[]} lines={[]} />)

    expect(chartMock.removeSeries).toHaveBeenCalledTimes(1)
    expect(chartMock.removeSeries.mock.calls[0]?.[0]).toBe(seriesMock.created[2])
  })

  it('actualiza los datos de una línea existente sin recrear la serie', () => {
    const { rerender } = render(<CandleChart candles={[]} lines={[line()]} />)
    const created = chartMock.addSeries.mock.calls.length

    rerender(<CandleChart candles={[]} lines={[line({ values: [{ time: 3_000, value: 99 }] })]} />)

    expect(chartMock.addSeries).toHaveBeenCalledTimes(created)
    expect(seriesMock.created[2]?.setData).toHaveBeenLastCalledWith([{ time: 3, value: 99 }])
    expect(seriesMock.created[2]?.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#2962ff', title: 'SMA 20' }),
    )
  })

  it('muestra la última vela en la leyenda por defecto', () => {
    render(<CandleChart candles={[candle(1_000, 123.45)]} lines={[]} />)

    const legend = screen.getByTestId('chart-legend')
    expect(legend).toHaveTextContent('1970-01-01 00:00')
    expect(legend).toHaveTextContent('123.45')
    expect(legend).toHaveTextContent('Volumen')
  })

  it('la leyenda sigue al cursor mediante subscribeCrosshairMove', () => {
    const candles = [candle(1_000, 100), candle(2_000, 200)]
    render(<CandleChart candles={candles} lines={[]} />)

    const handler = chartMock.subscribeCrosshairMove.mock.calls[0]?.[0] as (param: {
      time?: number
    }) => void
    expect(handler).toBeDefined()

    // Sin tiempo (cursor fuera del rango) → vuelve a la última vela.
    act(() => handler({ time: undefined }))
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('200')

    // Con tiempo → muestra la vela bajo el cursor.
    act(() => handler({ time: 1 }))
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('100')
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('1970-01-01 00:00')
  })

  it('muestra el estado vacío cuando no hay velas', () => {
    render(<CandleChart candles={[]} lines={[]} />)

    expect(screen.getByTestId('chart-empty')).toHaveTextContent('Sin datos para mostrar')
    expect(screen.queryByTestId('chart-legend')).not.toBeInTheDocument()
  })

  it('oculta el estado vacío en cuanto hay velas', () => {
    const { rerender } = render(<CandleChart candles={[]} lines={[]} />)
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument()

    rerender(<CandleChart candles={[candle(1_000)]} lines={[]} />)
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument()
  })

  it('sincroniza varias líneas a la vez y las elimina todas juntas', () => {
    const { rerender } = render(
      <CandleChart candles={[]} lines={[line(), line({ id: 'ema', label: 'EMA 20' })]} />,
    )
    expect(chartMock.addSeries).toHaveBeenCalledTimes(4)

    rerender(<CandleChart candles={[]} lines={[]} />)
    expect(chartMock.removeSeries).toHaveBeenCalledTimes(2)
  })
})
