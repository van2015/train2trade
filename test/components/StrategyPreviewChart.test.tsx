import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StrategyPreviewChart } from '@/components/StrategyPreviewChart'
import { Candle } from '@/domain/candles/candle'
import { minus, plus } from '@/domain/strategies/priceExpr'
import { StrategySpec } from '@/domain/strategies/spec'

const { chartMock, seriesMock } = vi.hoisted(() => {
  const makePriceLine = () => ({
    applyOptions: vi.fn<(options: unknown) => void>(),
    options: vi.fn(() => ({})),
  })
  type PriceLineMock = ReturnType<typeof makePriceLine>

  const priceLines: PriceLineMock[] = []

  const makeSeries = () => ({
    setData: vi.fn<(data: unknown[]) => void>(),
    applyOptions: vi.fn<(options: unknown) => void>(),
    createPriceLine: vi.fn<(options: unknown) => PriceLineMock>(() => {
      const line = makePriceLine()
      priceLines.push(line)
      return line
    }),
    removePriceLine: vi.fn<(line: unknown) => void>(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  })

  type AddSeriesFn = (
    definition: unknown,
    options?: unknown,
    paneIndex?: number,
  ) => ReturnType<typeof makeSeries>

  const seriesMock = {
    make: makeSeries,
    created: [] as ReturnType<typeof makeSeries>[],
    priceLines,
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
    subscribeCrosshairMove: vi.fn(),
  }

  return { chartMock, seriesMock }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartMock),
  CandlestickSeries: 'CandlestickSeries',
  LineSeries: 'LineSeries',
  ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
}))

function candle(index: number, close = 100): Candle {
  return Candle.from({
    time: 1_700_000_000_000 + index * 3_600_000,
    open: close,
    high: close + 10,
    low: close - 10,
    close,
    volume: 1,
  })
}

const CANDLES = Array.from({ length: 10 }, (_, index) => candle(index))

function spec(overrides: Partial<StrategySpec> = {}): StrategySpec {
  return {
    name: 'demo',
    version: 1,
    indicators: [{ alias: 'off', kind: 'const', value: 10 }],
    entry: {
      rule: { kind: 'condition', op: '>', a: 'off', b: 'close' },
      execution: 'market',
    },
    takeProfit: { price: plus('entry', 'off'), execution: 'market' },
    stopLoss: { price: minus('entry', 'off'), execution: 'market' },
    ...overrides,
  }
}

/** Serie de velas: la primera addSeries del chart (el resto son líneas). */
function candleSeries() {
  return seriesMock.created[0]
}

beforeEach(() => {
  chartMock.addSeries.mockClear()
  chartMock.remove.mockClear()
  chartMock.timeScale.mockClear()
  chartMock.timeScaleMock.fitContent.mockClear()
  seriesMock.created.length = 0
  seriesMock.priceLines.length = 0
})

describe('StrategyPreviewChart', () => {
  it('crea el chart una vez, sin volumen y sin scroll/zoom (preview fijo)', () => {
    render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    // velas + 1 línea (const 'off'); sin histograma de volumen.
    expect(chartMock.addSeries).toHaveBeenCalledTimes(2)
    expect(chartMock.addSeries.mock.calls.map((call) => call[0])).toEqual([
      'CandlestickSeries',
      'LineSeries',
    ])
  })

  it('crea el chart con handleScale/handleScroll desactivados', async () => {
    const { createChart } = await import('lightweight-charts')

    render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    expect(createChart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handleScale: false, handleScroll: false }),
    )
  })

  it('pinta las velas del draft y encaja el contenido', () => {
    render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    expect(candleSeries()?.setData).toHaveBeenCalledTimes(1)
    expect(candleSeries()?.setData).toHaveBeenCalledWith(
      CANDLES.map((entry) => ({
        time: Math.floor(entry.time / 1000),
        open: entry.open,
        high: entry.high,
        low: entry.low,
        close: entry.close,
      })),
    )
    expect(chartMock.timeScaleMock.fitContent).toHaveBeenCalledTimes(1)
  })

  it('dibuja los niveles del draft como líneas de precio punteadas con etiqueta', () => {
    render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    expect(candleSeries()?.createPriceLine).toHaveBeenCalledTimes(2)
    expect(candleSeries()?.createPriceLine).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        price: 110, // entry (cierre 100) + off (10)
        color: '#26a69a',
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'Take profit',
      }),
    )
    expect(candleSeries()?.createPriceLine).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ price: 90, color: '#ef5350', title: 'Stop loss' }),
    )
  })

  it('quita del chart el nivel que desaparece del draft (borrar TP)', () => {
    const { rerender } = render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)
    const created = seriesMock.priceLines[0]

    rerender(<StrategyPreviewChart candles={CANDLES} spec={spec({ takeProfit: undefined })} />)

    expect(candleSeries()?.removePriceLine).toHaveBeenCalledTimes(1)
    expect(candleSeries()?.removePriceLine).toHaveBeenCalledWith(created)
    // Acumulado: 2 del primer render; al re-renderizar no se recrea ninguno
    // (el SL existente se actualiza con applyOptions).
    expect(candleSeries()?.createPriceLine).toHaveBeenCalledTimes(2)
    expect(seriesMock.priceLines[1]?.applyOptions).toHaveBeenCalledTimes(1)
  })

  it('actualiza precio y color de un nivel que cambia al editar el draft', () => {
    const { rerender } = render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    rerender(
      <StrategyPreviewChart
        candles={CANDLES}
        spec={spec({ indicators: [{ alias: 'off', kind: 'const', value: 20 }] })}
      />,
    )

    // TP = 100 + 20 = 120: se reutiliza la línea creada, no se recrea.
    expect(candleSeries()?.createPriceLine).toHaveBeenCalledTimes(2)
    expect(seriesMock.priceLines[0]?.applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({ price: 120 }),
    )
  })

  it('crea series para los indicadores del draft vía syncLineSeries', () => {
    render(
      <StrategyPreviewChart
        candles={CANDLES}
        spec={spec({
          indicators: [
            { alias: 'off', kind: 'const', value: 10 },
            { alias: 'r', kind: 'rsi', period: 14 },
          ],
        })}
      />,
    )

    const calls = chartMock.addSeries.mock.calls
    expect(calls.map((call) => call[0])).toContain('LineSeries')
    // RSI al panel inferior (paneIndex 1).
    const rsiCall = calls.find((call) => call[0] === 'LineSeries' && call[2] === 1)
    expect(rsiCall).toBeDefined()
  })

  it('muestra la nota con lo omitido cuando algo del draft no evalúa', () => {
    render(
      <StrategyPreviewChart
        candles={CANDLES}
        spec={spec({ indicators: [{ alias: 'malo', kind: 'sma', period: 0 }] })}
      />,
    )

    const note = screen.getByTestId('preview-note')
    expect(note).toHaveTextContent('Omitidos:')
    expect(note).toHaveTextContent('indicador malo')
  })

  it('sin velas muestra el estado vacío y pinta el chart vacío', () => {
    render(<StrategyPreviewChart candles={[]} spec={spec()} />)

    expect(screen.getByTestId('preview-empty')).toHaveTextContent('Sin datos para previsualizar')
    expect(screen.queryByTestId('preview-note')).not.toBeInTheDocument()
    expect(candleSeries()?.setData).toHaveBeenCalledWith([])
  })

  it('destruye el chart al desmontar', () => {
    const { unmount } = render(<StrategyPreviewChart candles={CANDLES} spec={spec()} />)

    unmount()

    expect(chartMock.remove).toHaveBeenCalledTimes(1)
  })
})
