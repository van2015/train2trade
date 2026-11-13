import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BacktestResults } from '@/components/BacktestResults'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

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

/** Ejecuta el mismo backtest que el formulario del panel (parámetros por defecto: fee/slippage 0). */
function runExperiment(fast: number, slow: number, capital = 1000): Experiment {
  const strategy = new Strategy({
    name: 'sma-cross',
    indicators: { fast: new Sma(fast), slow: new Sma(slow) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
  return Experiment.run({
    strategy,
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: capital,
    execution: { slippageBps: 0, feeBps: 0 },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seriesMock.created.length = 0
})

describe('BacktestResults', () => {
  it('sin experimento muestra el estado vacío', () => {
    render(<BacktestResults experiment={null} />)

    expect(screen.getByTestId('backtest-results-empty')).toHaveTextContent(
      'Ejecuta un backtest para ver los resultados aquí',
    )
    expect(screen.queryByTestId('backtest-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('backtest-metrics')).not.toBeInTheDocument()
    expect(document.querySelector('.equity-chart')).not.toBeInTheDocument()
  })

  it('muestra resumen, métricas, equity y trades', () => {
    render(<BacktestResults experiment={runExperiment(2, 3)} />)

    // resumen del experimento (§12C)
    const summary = screen.getByTestId('backtest-summary')
    expect(summary).toHaveTextContent('sma-cross@1')
    expect(summary).toHaveTextContent('1 trade · 0 ganadores · 1 perdedor')
    expect(summary).toHaveTextContent('equity final')

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
    const trades = screen.getByTestId('backtest-trades')
    expect(trades).toHaveTextContent('Pérdida')
  })

  it('las métricas no definidas se muestran como guion', () => {
    render(<BacktestResults experiment={runExperiment(10, 30)} />) // sin señales: no cruzan en 9 velas

    expect(screen.getByText('Win rate').closest('tr')).toHaveTextContent('—')
    expect(screen.getByText('Profit factor').closest('tr')).toHaveTextContent('—')
    expect(screen.queryByTestId('backtest-trades')).not.toBeInTheDocument()
  })

  it('al cambiar de experimento se muestran sus resultados', () => {
    const { rerender } = render(<BacktestResults experiment={runExperiment(2, 3, 1000)} />)
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('-230.76923077')

    rerender(<BacktestResults experiment={runExperiment(2, 3, 2000)} />)

    const metrics = screen.getByTestId('backtest-metrics')
    expect(metrics).toHaveTextContent('-461.53846154')
    expect(metrics).not.toHaveTextContent('-230.76923077')
  })
})
