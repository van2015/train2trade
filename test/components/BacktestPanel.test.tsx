import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BacktestPanel, BacktestPanelProps } from '@/components/BacktestPanel'
import { BacktestResults } from '@/components/BacktestResults'
import { Experiment } from '@/domain/backtest/experiment'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

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

function renderPanel(
  candles: readonly Candle[] = CANDLES,
  props: Partial<BacktestPanelProps> = {},
) {
  return render(<BacktestPanel candles={candles} timeframe={Timeframe.HOUR} {...props} />)
}

function setCrossoverPeriods() {
  fireEvent.change(screen.getByLabelText('SMA rápida'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('SMA lenta'), { target: { value: '3' } })
}

/** Formulario + resultados cableados como en App (onResult → BacktestResults). */
function renderWithResults(props: Partial<BacktestPanelProps> = {}) {
  function Harness() {
    const [experiment, setExperiment] = useState<Experiment | null>(null)
    return (
      <>
        <BacktestPanel
          candles={CANDLES}
          timeframe={Timeframe.HOUR}
          onResult={setExperiment}
          {...props}
        />
        <BacktestResults experiment={experiment} />
      </>
    )
  }
  render(<Harness />)
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

describe('BacktestPanel — resultados (integración con BacktestResults)', () => {
  it('ejecutar el backtest muestra los resultados en el área de resultados', () => {
    renderWithResults()
    setCrossoverPeriods()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-summary')).toHaveTextContent('sma-cross@1')
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('Beneficio neto')
    expect(screen.getByTestId('backtest-trades')).toBeInTheDocument()
  })

  it('cambiar el capital y re-ejecutar actualiza las métricas', () => {
    renderWithResults()
    setCrossoverPeriods()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))
    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('-230.76923077')

    fireEvent.change(screen.getByLabelText('Capital inicial'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(screen.getByTestId('backtest-metrics')).toHaveTextContent('-461.53846154')
    expect(screen.getByTestId('backtest-metrics')).not.toHaveTextContent('-230.76923077')
  })
})

describe('BacktestPanel — registro (Fase 6)', () => {
  it('el checkbox "Cerrar posición al final" empieza desmarcado y alterna', () => {
    renderPanel()

    const checkbox = screen.getByLabelText('Cerrar posición al final')
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it('onExperiment y onResult reciben el experimento ejecutado, con el instrumento', () => {
    const onExperiment = vi.fn()
    const onResult = vi.fn()
    renderPanel(CANDLES, { onExperiment, onResult, instrument: Instrument.of('BTC', 'USDT') })
    setCrossoverPeriods()

    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(onExperiment).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledTimes(1)
    const experiment = onResult.mock.calls[0]?.[0] as Experiment
    expect(experiment).toBeInstanceOf(Experiment)
    expect(experiment.instrument?.toString()).toBe('BTC/USDT')
    expect(experiment.strategyId).toBe('sma-cross@1')
    expect(onExperiment.mock.calls[0]?.[0]).toBe(experiment)
  })

  it('sin onExperiment el panel funciona igual (prop opcional)', () => {
    const onResult = vi.fn()
    renderPanel(CANDLES, { onResult })
    setCrossoverPeriods()

    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar backtest' }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('backtest-error')).not.toBeInTheDocument()
  })
})
