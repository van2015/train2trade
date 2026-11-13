import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestForwardResults } from '@/components/TestForwardResults'
import { formatMetric } from '@/components/backtestForm'
import { runTestForward } from '@/domain/backtest/testForward'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000 // 2023-11-14 22:13 UTC
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

/** Corte válido: 22:17 entre i3 (22:16:20) e i4 (22:17:20) — velas de 1 minuto. */
const VALID_CUT = '2023-11-14T22:17'

function runWith(fast: number, slow: number) {
  return runTestForward({
    strategy: new Strategy({
      name: 'sma-cross',
      indicators: { fast: new Sma(fast), slow: new Sma(slow) },
      signals: [
        new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
        new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
      ],
    }),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    cutTime: Date.parse(`${VALID_CUT}:00Z`),
  })
}

describe('TestForwardResults', () => {
  it('sin run muestra el estado vacío', () => {
    render(<TestForwardResults run={null} />)

    expect(screen.getByTestId('tf-results-empty')).toHaveTextContent(
      'Ejecuta un test-forward para ver los resultados aquí',
    )
    expect(screen.queryByTestId('tf-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tf-table')).not.toBeInTheDocument()
  })

  it('pinta resumen y tabla dev/eval/Δ con los valores de runTestForward', () => {
    const expected = runWith(2, 3)
    render(<TestForwardResults run={expected} />)

    expect(screen.getByTestId('tf-summary')).toHaveTextContent('Desarrollo')
    expect(screen.getByTestId('tf-summary')).toHaveTextContent('Evaluación')

    const table = screen.getByTestId('tf-table')
    expect(table).toHaveTextContent('Desarrollo')
    expect(table).toHaveTextContent('Evaluación')

    const roiRow = screen.getByText('ROI').closest('tr')
    expect(roiRow).toHaveTextContent(
      formatMetric(expected.development.result.metrics.roi, 'percent'),
    )
    expect(roiRow).toHaveTextContent(
      formatMetric(expected.evaluation.result.metrics.roi, 'percent'),
    )
    expect(roiRow).toHaveTextContent(formatMetric(expected.deltas.roi ?? null, 'percent'))

    // ocho filas de métricas
    expect(screen.getAllByRole('row')).toHaveLength(9) // cabecera + 8
  })

  it('métricas null en ambos lados → celda de delta como guion', () => {
    render(<TestForwardResults run={runWith(10, 30)} />) // periodos 10/30: sin trades en 9 velas

    const winRateRow = screen.getByText('Win rate').closest('tr')
    expect(winRateRow).toHaveTextContent('—')
  })
})
