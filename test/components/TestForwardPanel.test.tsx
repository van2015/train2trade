import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TestForwardPanel, type TestForwardPanelProps } from '@/components/TestForwardPanel'
import { TestForwardResults } from '@/components/TestForwardResults'
import { Experiment } from '@/domain/backtest/experiment'
import { runTestForward, type TestForwardRun } from '@/domain/backtest/testForward'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { formatMetric } from '@/components/backtestForm'

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

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'sma-cross',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

function renderPanel(
  candles: readonly Candle[] = CANDLES,
  props: Partial<TestForwardPanelProps> = {},
) {
  const onExperiment = vi.fn()
  const view = render(
    <TestForwardPanel
      candles={candles}
      timeframe={Timeframe.HOUR}
      onExperiment={onExperiment}
      {...props}
    />,
  )
  return { ...view, onExperiment }
}

/** Formulario + resultados cableados como en App (onResult → TestForwardResults). */
function renderWithResults(candles: readonly Candle[] = CANDLES) {
  function Harness() {
    const [run, setRun] = useState<TestForwardRun | null>(null)
    return (
      <>
        <TestForwardPanel
          candles={candles}
          timeframe={Timeframe.HOUR}
          onExperiment={vi.fn()}
          onResult={setRun}
        />
        <TestForwardResults run={run} />
      </>
    )
  }
  render(<Harness />)
}

function setCut(value: string): void {
  fireEvent.change(screen.getByLabelText('Corte (UTC)'), { target: { value } })
}

function setCrossoverPeriods(): void {
  fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('SMA lenta'), { target: { value: '3' } })
}

function run(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar test-forward' }))
}

describe('TestForwardPanel — parámetros y validación', () => {
  it('sin velas → aviso y botón deshabilitado', () => {
    renderPanel([])

    expect(screen.getByTestId('tf-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Ejecutar test-forward' })).toBeDisabled()
  })

  it('fecha de corte vacía o fuera del rango de velas → error, sin resultados', () => {
    renderPanel()
    run()
    expect(screen.getByTestId('tf-error')).toHaveTextContent('Corte')
    expect(screen.queryByTestId('tf-table')).not.toBeInTheDocument()

    setCut('2023-11-14T00:00') // antes de la primera vela (22:13)
    run()
    expect(screen.getByTestId('tf-error')).toHaveTextContent('dentro del rango')

    setCut('2024-12-31T00:00') // después de la última
    run()
    expect(screen.getByTestId('tf-error')).toHaveTextContent('dentro del rango')
    expect(screen.queryByTestId('tf-table')).not.toBeInTheDocument()
  })

  it('parámetros inválidos → error del formulario compartido', () => {
    renderPanel()
    setCut(VALID_CUT)
    fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2.5' } })

    run()

    expect(screen.getByTestId('tf-error')).toHaveTextContent('SMA rápida')
    expect(screen.queryByTestId('tf-table')).not.toBeInTheDocument()
  })
})

describe('TestForwardPanel — resultados (integración con TestForwardResults, §7C)', () => {
  it('ejecutar pinta resumen y tabla dev/eval/Δ con los valores de runTestForward', () => {
    renderWithResults()
    setCut(VALID_CUT)
    setCrossoverPeriods()
    run()

    const expected = runTestForward({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      cutTime: Date.parse(`${VALID_CUT}:00Z`),
    })

    expect(screen.queryByTestId('tf-error')).not.toBeInTheDocument()
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

  it('llama a onExperiment con desarrollo y evaluación, y a onResult con el run', () => {
    const onResult = vi.fn()
    const { onExperiment } = renderPanel(CANDLES, { onResult })
    setCut(VALID_CUT)
    setCrossoverPeriods()
    run()

    expect(onExperiment).toHaveBeenCalledTimes(2)
    const development = onExperiment.mock.calls[0]?.[0] as Experiment
    const evaluation = onExperiment.mock.calls[1]?.[0] as Experiment
    expect(development).toBeInstanceOf(Experiment)
    expect(evaluation).toBeInstanceOf(Experiment)
    expect(development.period.to).toBeLessThan(evaluation.period.from)

    expect(onResult).toHaveBeenCalledTimes(1)
    const runResult = onResult.mock.calls[0]?.[0] as TestForwardRun
    expect(runResult.cutTime).toBe(Date.parse(`${VALID_CUT}:00Z`))
    expect(runResult.development).toBe(development)
    expect(runResult.evaluation).toBe(evaluation)
  })
})
