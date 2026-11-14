import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { OptimizationPanel, type OptimizationPanelProps } from '@/components/OptimizationPanel'
import { OptimizationResults, type OptimizationViewState } from '@/components/OptimizationResults'
import { runOptimization } from '@/domain/backtest/optimization'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
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

/** Estrategia activa por defecto en los tests (§1.9): periodos 10/30 como la demo. */
const SPEC: StrategySpec = {
  name: 'sma-cross',
  version: 1,
  indicators: [
    { alias: 'fast', kind: 'sma', period: 10 },
    { alias: 'slow', kind: 'sma', period: 30 },
  ],
  entry: {
    rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
    execution: 'market',
  },
  exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
}

/** Estrategia sin indicadores con periodo (solo constantes) → nada que optimizar. */
const CONST_SPEC: StrategySpec = {
  name: 'const-only',
  version: 1,
  indicators: [{ alias: 'umbral', kind: 'const', value: 30 }],
  entry: {
    rule: { kind: 'condition', op: '>', a: 'close', b: 'umbral' },
    execution: 'market',
  },
}

/** Fábrica esperada: la spec elegida con los periodos de la rejilla (§13). */
const expectedFactory = (
  params: Readonly<Record<string, number>>,
): ReturnType<typeof buildStrategy> =>
  buildStrategy({
    ...SPEC,
    indicators: SPEC.indicators.map((indicator) =>
      indicator.kind === 'const'
        ? indicator
        : { ...indicator, period: params[indicator.alias] ?? indicator.period },
    ),
  })

function renderPanel(
  candles: readonly Candle[] = CANDLES,
  props: Partial<OptimizationPanelProps> = {},
) {
  const { strategy = SPEC, ...rest } = props
  return render(
    <OptimizationPanel
      candles={candles}
      timeframe={Timeframe.HOUR}
      strategy={strategy}
      {...rest}
    />,
  )
}

/** Formulario + resultados cableados como en App (onResult → OptimizationResults). */
function renderWithResults(candles: readonly Candle[] = CANDLES) {
  function Harness() {
    const [view, setView] = useState<OptimizationViewState | null>(null)
    return (
      <>
        <OptimizationPanel
          candles={candles}
          timeframe={Timeframe.HOUR}
          strategy={SPEC}
          onResult={setView}
        />
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

/** Deja los rangos en fast [2,3] × slow [3,4] (4 combinaciones). */
function setSmallGrid(): void {
  setField('fast desde', '2')
  setField('fast hasta', '3')
  setField('slow desde', '3')
  setField('slow hasta', '4')
}

describe('OptimizationPanel — parámetros y cap (§13)', () => {
  it('sin velas → aviso, botón deshabilitado y defaults centrados en la spec', () => {
    renderPanel([])

    expect(screen.getByTestId('opt-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()
    expect(screen.getByLabelText('fast desde')).toHaveValue(6) // 10 ± 4
    expect(screen.getByLabelText('fast hasta')).toHaveValue(14)
    expect(screen.getByLabelText('slow desde')).toHaveValue(26) // 30 ± 4
    expect(screen.getByLabelText('slow hasta')).toHaveValue(34)
    expect(screen.getByLabelText('Métrica a optimizar')).toHaveValue('netProfit')
    expect(screen.queryByTestId('opt-cap')).not.toBeInTheDocument()
  })

  it('sin estrategia activa → aviso, sin rangos y botón deshabilitado', () => {
    renderPanel(CANDLES, { strategy: null })

    expect(screen.getByTestId('opt-no-strategy')).toHaveTextContent('Estrategia')
    expect(screen.queryByLabelText('fast desde')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()
  })

  it('estrategia sin indicadores con periodo → aviso y botón deshabilitado', () => {
    renderPanel(CANDLES, { strategy: CONST_SPEC })

    expect(screen.getByTestId('opt-no-params')).toHaveTextContent('periodo')
    expect(screen.getByRole('button', { name: 'Ejecutar optimización' })).toBeDisabled()
  })

  it('rangos inválidos → error sin resultados', () => {
    renderPanel()

    setField('fast desde', '10')
    setField('fast hasta', '2')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('fast')
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument()

    setField('fast desde', '2')
    setField('fast hasta', '10')
    setField('fast paso', '0')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('paso')

    setField('fast paso', '1')
    setField('slow desde', '1.5')
    run()
    expect(screen.getByTestId('opt-error')).toHaveTextContent('slow')
  })

  it('el cap se avisa ANTES de ejecutar y deshabilita el botón', () => {
    renderPanel()

    setField('fast desde', '1')
    setField('fast hasta', '40')
    setField('slow desde', '1')
    setField('slow hasta', '40')

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
    setSmallGrid()
    run()

    const expected = runOptimization({
      buildStrategy: expectedFactory,
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
    setSmallGrid()
    run()

    expect(screen.getByTestId('opt-runs')).toHaveTextContent('Beneficio neto')

    setField('Métrica a optimizar', 'maxDrawdown')
    run()
    expect(screen.getByTestId('opt-runs')).toHaveTextContent('Drawdown máximo')
  })

  it('onResult recibe la vista de resultados', () => {
    const onResult = vi.fn()
    renderPanel(CANDLES, { onResult })
    setSmallGrid()
    run()

    expect(onResult).toHaveBeenCalledTimes(1)
    const view = onResult.mock.calls[0]?.[0] as OptimizationViewState
    expect(view.optimization.runs).toHaveLength(4)
    expect(view.optimization.metric).toBe('netProfit')
    expect(screen.queryByTestId('opt-runs')).not.toBeInTheDocument() // sin resultados en el panel
  })
})
