import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { OptimizationResults, type OptimizationViewState } from '@/components/OptimizationResults'
import { formatMetric } from '@/components/backtestForm'
import { runOptimization } from '@/domain/backtest/optimization'
import { analyzeRobustness } from '@/domain/backtest/robustness'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000
const stepMs = 60_000
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

/** Misma construcción que el formulario de `OptimizationPanel`. */
function buildView(
  grid: Readonly<Record<string, readonly number[]>>,
  metric: 'netProfit' | 'winRate',
): OptimizationViewState {
  const optimization = runOptimization({
    buildStrategy: (params) =>
      new Strategy({
        name: 'sma-cross',
        indicators: { fast: new Sma(params.fast ?? 10), slow: new Sma(params.slow ?? 30) },
        signals: [
          new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
          new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
        ],
      }),
    grid,
    metric,
    base: { candles: CANDLES, timeframe: Timeframe.HOUR, initialCapital: 1_000 },
  })

  let robustness: AnalysisState = null
  let note: string | null = null
  try {
    robustness = analyzeRobustness(optimization)
  } catch (caught) {
    note = caught instanceof Error ? caught.message : String(caught)
  }
  return { optimization, robustness, note }
}

type AnalysisState = OptimizationViewState['robustness']

describe('OptimizationResults', () => {
  it('sin resultados muestra el estado vacío', () => {
    render(<OptimizationResults view={null} />)

    expect(screen.getByTestId('opt-results-empty')).toHaveTextContent(
      'Ejecuta una optimización para ver los resultados aquí',
    )
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('opt-robustness')).not.toBeInTheDocument()
  })

  it('pinta la tabla de runs ordenada y el informe de robustez', () => {
    const view = buildView({ fast: [2, 3], slow: [3, 4] }, 'netProfit')
    render(<OptimizationResults view={view} />)

    const table = screen.getByTestId('opt-runs')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    // la primera fila es el mejor de la métrica (misma semántica que rankBy)
    expect(rows[0]).toHaveTextContent(
      `fast ${view.optimization.best.params.fast} · slow ${view.optimization.best.params.slow}`,
    )
    expect(rows[0]).toHaveTextContent(
      formatMetric(view.optimization.best.metrics.netProfit, 'money'),
    )

    const robustness = screen.getByTestId('opt-robustness')
    expect(robustness).toHaveTextContent('Mejor')
    expect(robustness).toHaveTextContent('Media')
    expect(robustness).toHaveTextContent('Plateau')
    expect(robustness).toHaveTextContent('Sensibilidad')
    expect(robustness).toHaveTextContent('fast')
    expect(robustness).toHaveTextContent('slow')
  })

  it('si la métrica es null en todas, muestra los runs y una nota (sin crash)', () => {
    const view = buildView({ fast: [10], slow: [30] }, 'winRate')
    render(<OptimizationResults view={view} />)

    expect(screen.getByTestId('opt-runs')).toBeInTheDocument()
    expect(within(screen.getByTestId('opt-runs')).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByTestId('opt-note')).toHaveTextContent('winRate')
    expect(screen.queryByTestId('opt-robustness')).not.toBeInTheDocument()
  })
})
