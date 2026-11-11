import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BacktestPanel } from '@/components/BacktestPanel'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'

const { chartMock, seriesMock } = vi.hoisted(() => {
  const makeSeries = () => ({
    setData: vi.fn<(data: unknown[]) => void>(),
    applyOptions: vi.fn<(options: unknown) => void>(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  })

  const timeScaleMock = { fitContent: vi.fn() }
  const seriesMock = { created: [] as ReturnType<typeof makeSeries>[] }

  const chartMock = {
    addSeries: vi.fn<() => ReturnType<typeof makeSeries>>(() => {
      const series = makeSeries()
      seriesMock.created.push(series)
      return series
    }),
    removeSeries: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => timeScaleMock),
    timeScaleMock,
  }

  return { chartMock, seriesMock }
})

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => chartMock),
  AreaSeries: 'AreaSeries',
  ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
  PriceLineSource: { LastBar: 0, LastValue: 1 },
}))

const t0 = 1_700_000_000_000
const step = 60_000

/** Mismo cruce que los E2E: SMA(2) cruza al alza en i4 y a la baja en i7. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * step,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

function renderPanel(candles: readonly Candle[] = CANDLES) {
  return render(<BacktestPanel candles={candles} timeframe={Timeframe.HOUR} />)
}

function setCrossoverPeriods() {
  fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('SMA lenta'), { target: { value: '3' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
})

describe('BacktestPanel — parámetros', () => {
  it('muestra los parámetros por defecto', () => {
    renderPanel()

    expect(screen.getByLabelText('Capital inicial')).toHaveValue(1000)
    expect(screen.getByLabelText('Comisión (bps)')).toHaveValue(0)
    expect(screen.getByLabelText('Slippage (bps)')).toHaveValue(0)
    expect(screen.getByLabelText('SMA rápida')).toHaveValue(10)
    expect(screen.getByLabelText('SMA lenta')).toHaveValue(30)
    expect(screen.getByRole('button', { name: 'Ejecutar backtest' })).toBeInTheDocument()
  })

  it('sin velas muestra aviso y deshabilita el botón', () => {
    renderPanel([])

    expect(screen.getByTestId('backtest-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Ejecutar backtest' })).toBeDisabled()
  })

  it('valida el capital inicial antes de ejecutar', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Capital inicial'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-error')).toHaveTextContent('Capital inicial')
    expect(screen.queryByTestId('backtest-metrics')).not.toBeInTheDocument()
  })

  it('valida los bps (>= 0)', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Comisión (bps)'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-error')).toHaveTextContent('Comisión (bps)')
  })

  it('valida que los periodos sean enteros >= 1', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-error')).toHaveTextContent('SMA rápida')
    expect(screen.queryByTestId('backtest-metrics')).not.toBeInTheDocument()
  })
})

describe('BacktestPanel — resultados', () => {
  it('ejecuta el backtest y muestra resumen, métricas, equity y trades', () => {
    renderPanel()
    setCrossoverPeriods()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    // resumen del experimento (§12C)
    const summary = screen.getByTestId('backtest-summary')
    expect(summary).toHaveTextContent('sma-cross@1')

    // métricas (conjunto mínimo de 8)
    const metrics = screen.getByTestId('backtest-metrics')
    expect(metrics).toHaveTextContent('Beneficio neto')
    expect(metrics).toHaveTextContent('-230.76923077') // 769.23 − 1000
    expect(metrics).toHaveTextContent('ROI')
    expect(metrics).toHaveTextContent('-23.08%')
    expect(metrics).toHaveTextContent('Drawdown máximo')
    expect(metrics).toHaveTextContent('Win rate')
    expect(metrics).toHaveTextContent('0.00%')
    expect(metrics).toHaveTextContent('Sharpe')
    expect(metrics).toHaveTextContent('Profit factor')

    // equity curve
    expect(document.querySelector('.equity-chart')).toBeInTheDocument()
    expect(seriesMock.created[0]?.setData).toHaveBeenCalledTimes(1)

    // trades
    expect(screen.getByTestId('backtest-summary')).toHaveTextContent(
      '1 trade · 0 ganadores · 1 perdedor',
    )
    const trades = screen.getByTestId('backtest-trades')
    expect(trades).toHaveTextContent('Pérdida')
  })

  it('las métricas no definidas se muestran como guion', () => {
    renderPanel() // sin señales: periods 10/30 no cruzan en 9 velas
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    const metrics = screen.getByTestId('backtest-metrics')
    expect(screen.getByText('Win rate').closest('tr')).toHaveTextContent('—')
    expect(screen.getByText('Profit factor').closest('tr')).toHaveTextContent('—')
    expect(screen.queryByTestId('backtest-trades')).not.toBeInTheDocument()
  })

  it('cambiar el capital y re-ejecutar actualiza las métricas', () => {
    renderPanel()
    setCrossoverPeriods()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('-230.76923077')

    fireEvent.change(screen.getByLabelText('Capital inicial'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('-461.53846154')
    expect(screen.getByTestId('backtest-metrics')).not.toHaveTextContent('-230.76923077')
  })
})
