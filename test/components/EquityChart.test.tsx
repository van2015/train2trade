import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { EquityChart } from '@/components/EquityChart'
import { createChart } from 'lightweight-charts'

const { chartMock, seriesMock } = vi.hoisted(() => {
  const makeSeries = () => ({
    setData: vi.fn<(data: unknown[]) => void>(),
    applyOptions: vi.fn<(options: unknown) => void>(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
    createPriceLine: vi.fn<(options: unknown) => { removePriceLine: () => void }>(() => ({
      removePriceLine: vi.fn(),
    })),
  })

  const timeScaleMock = { fitContent: vi.fn() }
  const seriesMock = { created: [] as ReturnType<typeof makeSeries>[] }

  const chartMock = {
    addSeries: vi.fn<(definition: unknown, options?: unknown) => ReturnType<typeof makeSeries>>(
      () => {
        const series = makeSeries()
        seriesMock.created.push(series)
        return series
      },
    ),
    removeSeries: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => timeScaleMock),
    timeScaleMock,
    subscribeCrosshairMove: vi.fn(),
    panes: vi.fn(() => []),
  }

  return { chartMock, seriesMock }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartMock),
  AreaSeries: 'AreaSeries',
  ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
}))

const POINTS = [
  { time: 1_700_000_000_000, equity: 1_000 },
  { time: 1_700_000_060_000, equity: 1_100 },
]

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
})

describe('EquityChart', () => {
  it('crea el gráfico al montar y lo destruye al desmontar', () => {
    const { unmount } = render(<EquityChart points={POINTS} />)

    expect(createChart).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createChart).mock.calls[0]?.[0]).toBeInstanceOf(HTMLDivElement)

    unmount()
    expect(chartMock.remove).toHaveBeenCalledTimes(1)
  })

  it('añade una serie de área y le pasa los datos con fitContent', () => {
    render(<EquityChart points={POINTS} />)

    expect(chartMock.addSeries).toHaveBeenCalledTimes(1)
    expect(chartMock.addSeries.mock.calls[0]?.[0]).toBe('AreaSeries')
    expect(seriesMock.created[0]?.setData).toHaveBeenCalledWith([
      { time: 1_700_000_000, value: 1_000 },
      { time: 1_700_000_060, value: 1_100 },
    ])
    expect(chartMock.timeScaleMock.fitContent).toHaveBeenCalledTimes(1)
  })

  it('actualiza los datos al cambiar los puntos sin recrear el gráfico', () => {
    const { rerender } = render(<EquityChart points={POINTS} />)
    expect(chartMock.addSeries).toHaveBeenCalledTimes(1)

    rerender(<EquityChart points={[{ time: 1_700_000_120_000, equity: 900 }]} />)

    expect(chartMock.addSeries).toHaveBeenCalledTimes(1)
    expect(seriesMock.created[0]?.setData).toHaveBeenLastCalledWith([
      { time: 1_700_000_120, value: 900 },
    ])
  })
})
