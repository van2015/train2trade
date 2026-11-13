import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { OptimizationPanel, type OptimizationPanelProps } from '@/components/OptimizationPanel'
import { OptimizationResults, type OptimizationViewState } from '@/components/OptimizationResults'
import { runOptimization } from '@/domain/backtest/optimization'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { formatMetric } from '@/components/backtestForm'

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

function renderPanel(
  candles: readonly Candle[] = CANDLES,
  props: Partial<OptimizationPanelProps> = {},
) {
  return render(<OptimizationPanel candles={candles} timeframe={Timeframe.HOUR} {...props} />)
}

/** Formulario + resultados cableados como en App (onResult → OptimizationResults). */
function renderWithResults(candles: readonly Candle[] = CANDLES) {
  function Harness() {
    const [view, setView] = useState<OptimizationViewState | null>(null)
    return (
      <>
        <OptimizationPanel candles={candles} timeframe={Timeframe.HOUR} onResult={setView} />
        <OptimizationResults view={view} />
      </>
    )
  }
  render(<Harness />)
}

function setField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function run(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar optimización' }))
}

describe('OptimizationPanel — parámetros y cap (§13)', () => {
  it('sin velas → aviso, botón deshabilitado y defaults correctos', () => {
    renderPanel([])

    expect(screen.getByTestId('opt-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()
    expect(screen.getByLabelText('SMA rápida desde')).toHaveValue(2)
    expect(screen.getByLabelText('SMA lenta hasta')).toHaveValue(40)
    expect(screen.getByLabelText('Métrica a optimizar')).toHaveValue('netProfit')
    expect(screen.queryByTestId('opt-cap')).not.toBeInTheDocument()
  })

  it('rangos inválidos → error sin resultados', () => {
    renderPanel()

    setField('SMA rápida desde', '10')
    setField('SMA rápida hasta', '2')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('SMA rápida')
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument()

    setField('SMA rápida desde', '2')
    setField('SMA rápida hasta', '10')
    setField('SMA rápida paso', '0')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('paso')

    setField('SMA rápida paso', '1')
    setField('SMA lenta desde', '1.5')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('SMA lenta')
  })

  it('el cap se avisa ANTES de ejecutar y deshabilita el botón', () => {
    renderPanel()

    setField('SMA rápida desde', '1')
    setField('SMA rápida hasta', '40')
    setField('SMA rápida paso', '1')
    setField('SMA lenta desde', '1')
    setField('SMA lenta hasta', '40')
    setField('SMA lenta paso', '1')

    const aviso = screen.getByTestId('opt-cap')
    expect(aviso).toHaveTextContent('1600')
    expect(aviso).toHaveTextContent('1000')
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument()
  })
})

describe('OptimizationPanel — resultados (integración con OptimizationResults)', () => {
  it('ejecutar pinta la tabla de runs ordenada y el informe de robustez', () => {
    renderWithResults()
    setField('SMA rápida hasta', '3')
    setField('SMA lenta desde', '3')
    setField('SMA lenta hasta', '4')
    setField('SMA lenta paso', '1')
    run()

    const expected = runOptimization({
      buildStrategy: (params) =>
        new Strategy({
          name: 'sma-cross',
          indicators: { fast: new Sma(params.fast ?? 10), slow: new Sma(params.slow ?? 30) },
          signals: [
            new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
            new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
          ],
        }),
      grid: { fast: [2, 3], slow: [3, 4] },
      metric: 'netProfit',
      base: { candles: CANDLES, timeframe: Timeframe.HOUR, initialCapital: 1_000 },
    })

    expect(screen.queryByTestId('opt-error')).not.toBeInTheDocument()
    const table = screen.getByTestId('opt-runs')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    // la primera fila es el mejor de la métrica (misma semántica que rankBy)
    expect(rows[0]).toHaveTextContent(
      `fast ${expected.best.params.fast} · slow ${expected.best.params.slow}`,
    )
    expect(rows[0]).toHaveTextContent(formatMetric(expected.best.metrics.netProfit, 'money'))

    const robustness = screen.getByTestId('opt-robustness')
    expect(robustness).toHaveTextContent('Mejor')
    expect(robustness).toHaveTextContent('Media')
    expect(robustness).toHaveTextContent('Plateau')
    expect(robustness).toHaveTextContent('Sensibilidad')
    expect(robustness).toHaveTextContent('fast')
    expect(robustness).toHaveTextContent('slow')
  })

  it('el selector de métrica cambia la columna mostrada (al re-ejecutar)', () => {
    renderWithResults()
    setField('SMA rápida hasta', '3')
    setField('SMA lenta desde', '3')
    setField('SMA lenta hasta', '4')
    setField('SMA lenta paso', '1')
    run()

    expect(screen.getByTestId('opt-runs')).toHaveTextContent('Beneficio neto')

    setField('Métrica a optimizar', 'maxDrawdown')
    run()
    expect(screen.getByTestId('opt-runs')).toHaveTextContent('Drawdown máximo')
  })

  it('onResult recibe la vista de resultados', () => {
    const onResult = vi.fn()
    renderPanel(CANDLES, { onResult })
    setField('SMA rápida hasta', '3')
    setField('SMA lenta desde', '3')
    setField('SMA lenta hasta', '4')
    setField('SMA lenta paso', '1')
    run()

    expect(onResult).toHaveBeenCalledTimes(1)
    const view = onResult.mock.calls[0]?.[0] as OptimizationViewState
    expect(view.optimization.runs).toHaveLength(4)
    expect(view.optimization.metric).toBe('netProfit')
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument() // sin resultados en el panel
  })
})
