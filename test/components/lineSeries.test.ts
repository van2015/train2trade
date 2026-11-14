import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lineOptions, LOWER_PANE_INDEX, syncLineSeries } from '@/components/lineSeries'
import type { ChartLine } from '@/components/chartData'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'

const { chartMock, seriesMock } = vi.hoisted(() => {
  const makeSeries = () => ({
    setData: vi.fn<(data: unknown[]) => void>(),
    applyOptions: vi.fn<(options: unknown) => void>(),
    createPriceLine: vi.fn<(options: unknown) => void>(),
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

  const chartMock = {
    addSeries: vi.fn<AddSeriesFn>(() => {
      const series = makeSeries()
      seriesMock.created.push(series)
      return series
    }),
    removeSeries: vi.fn<(series: unknown) => void>(),
  }

  return { chartMock, seriesMock }
})

vi.mock('lightweight-charts', () => ({
  LineSeries: 'LineSeries',
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
}))

function line(overrides: Partial<ChartLine> = {}): ChartLine {
  return {
    id: 'sma',
    label: 'SMA 20',
    color: '#2962ff',
    values: [{ time: 1_000, value: 105 }],
    pane: 'price',
    ...overrides,
  }
}

/** Store + chart simulados con las interfaces reales (los mocks cumplen structuralmente). */
function harness() {
  const store = new Map<string, ISeriesApi<'Line'>>()
  const chart = chartMock as unknown as IChartApi
  return { store, chart }
}

beforeEach(() => {
  chartMock.addSeries.mockClear()
  chartMock.removeSeries.mockClear()
  seriesMock.created.length = 0
})

describe('lineOptions', () => {
  it('sin rango fijo: opciones básicas sin autoscaleInfoProvider', () => {
    expect(lineOptions(line())).toEqual({
      color: '#2962ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'SMA 20',
    })
  })

  it('con rango fijo: incluye autoscaleInfoProvider con el rango acotado', () => {
    const options = lineOptions(line({ fixedRange: { min: 0, max: 100 } }))

    expect(options.autoscaleInfoProvider?.().priceRange).toEqual({
      minValue: 0,
      maxValue: 100,
    })
  })
})

describe('syncLineSeries', () => {
  it('crea las series nuevas en su panel y las registra en el store', () => {
    const { store, chart } = harness()

    syncLineSeries(chart, store, [line(), line({ id: 'rsi', pane: 'lower' })])

    expect(chartMock.addSeries).toHaveBeenCalledTimes(2)
    expect(chartMock.addSeries.mock.calls[0]?.[0]).toBe('LineSeries')
    expect(chartMock.addSeries.mock.calls[0]?.[2]).toBe(0)
    expect(chartMock.addSeries.mock.calls[1]?.[2]).toBe(LOWER_PANE_INDEX)
    expect([...store.keys()]).toEqual(['sma', 'rsi'])
    expect(seriesMock.created[0]?.setData).toHaveBeenCalledWith([
      { time: 1, value: 105 }, // toLineData convierte ms → segundos
    ])
  })

  it('las referenceLines nuevas se dibujan punteadas con eje', () => {
    const { store, chart } = harness()

    syncLineSeries(chart, store, [line({ id: 'rsi', referenceLines: [30, 70] })])

    expect(seriesMock.created[0]?.createPriceLine).toHaveBeenCalledTimes(2)
    expect(seriesMock.created[0]?.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 30, lineStyle: 2, axisLabelVisible: true }),
    )
  })

  it('las series existentes actualizan color/título y datos, sin recrearlas', () => {
    const { store, chart } = harness()
    syncLineSeries(chart, store, [line()])
    const [created] = seriesMock.created

    syncLineSeries(chart, store, [line({ label: 'SMA 50', color: '#ff9800' })])

    expect(chartMock.addSeries).toHaveBeenCalledTimes(1) // no recrea
    expect(created?.applyOptions).toHaveBeenCalledWith({ color: '#ff9800', title: 'SMA 50' })
    expect(created?.setData).toHaveBeenCalledTimes(2)
  })

  it('quita del chart y del store las series que desaparecen', () => {
    const { store, chart } = harness()
    syncLineSeries(chart, store, [line(), line({ id: 'ema' })])
    const [first] = seriesMock.created

    syncLineSeries(chart, store, [line({ id: 'ema' })])

    expect(chartMock.removeSeries).toHaveBeenCalledTimes(1)
    expect(chartMock.removeSeries).toHaveBeenCalledWith(first)
    expect([...store.keys()]).toEqual(['ema'])
  })

  it('con líneas vacías vacía el store', () => {
    const { store, chart } = harness()
    syncLineSeries(chart, store, [line()])

    syncLineSeries(chart, store, [])

    expect([...store.keys()]).toEqual([])
  })
})
