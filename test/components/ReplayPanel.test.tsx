import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReplayPanel } from '@/components/ReplayPanel'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { StrategySpec } from '@/domain/strategies/spec'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E: cruce SMA(2)/SMA(3) al alza en i4. */
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

/** Estrategia activa por defecto en los tests: sma-cross(2/3) (§1.9). */
const SPEC: StrategySpec = {
  name: 'sma-cross',
  version: 1,
  indicators: [
    { alias: 'fast', kind: 'sma', period: 2 },
    { alias: 'slow', kind: 'sma', period: 3 },
  ],
  entry: {
    rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
    execution: 'market',
  },
  exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
}

function renderPanel(candles: readonly Candle[] = CANDLES, onProgress = vi.fn()) {
  const view = render(
    <ReplayPanel
      candles={candles}
      timeframe={Timeframe.HOUR}
      strategy={SPEC}
      onProgress={onProgress}
    />,
  )
  return { ...view, onProgress }
}

function startSession() {
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
}

function stepOnce() {
  fireEvent.click(screen.getByRole('button', { name: 'Paso' }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ReplayPanel — parámetros', () => {
  it('muestra los parámetros por defecto y la estrategia activa', () => {
    renderPanel()

    expect(screen.getByLabelText('Capital inicial')).toHaveValue(1000)
    expect(screen.getByLabelText('Comisión (bps)')).toHaveValue(0)
    expect(screen.getByLabelText('Slippage (bps)')).toHaveValue(0)
    expect(screen.getByTestId('replay-strategy-hint')).toHaveTextContent('sma-cross@1')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('sin velas muestra aviso y deshabilita el inicio', () => {
    renderPanel([])

    expect(screen.getByTestId('replay-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  })

  it('sin estrategia activa muestra el aviso y deshabilita el inicio', () => {
    render(
      <ReplayPanel
        candles={CANDLES}
        timeframe={Timeframe.HOUR}
        strategy={null}
        onProgress={vi.fn()}
      />,
    )

    expect(screen.getByTestId('replay-no-strategy')).toHaveTextContent('Estrategia')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  })

  it('valida el capital antes de iniciar', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Capital inicial'), { target: { value: '0' } })
    startSession()

    expect(screen.getByTestId('replay-error')).toHaveTextContent('Capital inicial')
    expect(screen.queryByTestId('replay-progress')).not.toBeInTheDocument()
  })
})

describe('ReplayPanel — sesión', () => {
  it('iniciar crea la sesión: progreso 0/N, controles y lectura inicial', () => {
    const { onProgress } = renderPanel()
    startSession()

    expect(screen.getByTestId('replay-progress')).toHaveTextContent('0 / 9 velas')
    expect(onProgress).toHaveBeenCalledWith(0)
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva sesión' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Paso' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reiniciar' })).toBeEnabled()
    expect(screen.getByLabelText('Velocidad')).toHaveValue('1')
    expect(screen.getByLabelText('Fracción (%)')).toHaveValue(25)

    expect(screen.getByTestId('replay-equity')).toHaveTextContent('1,000')
    expect(screen.getByTestId('replay-position')).toHaveTextContent('sin posición')
    expect(screen.getByTestId('replay-strategy')).toHaveTextContent('Esperando señal')
    expect(screen.getByTestId('replay-pending')).toHaveTextContent(/^0$/)
  })

  it('Paso avanza exactamente una vela y notifica el cursor', () => {
    const { onProgress } = renderPanel()
    startSession()
    stepOnce()

    expect(screen.getByTestId('replay-progress')).toHaveTextContent('1 / 9 velas')
    expect(onProgress).toHaveBeenLastCalledWith(1)
    stepOnce()
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('2 / 9 velas')
    expect(onProgress).toHaveBeenLastCalledWith(2)
  })

  it('las decisiones y operaciones de la estrategia aparecen en el log', () => {
    renderPanel()
    startSession()

    for (let i = 0; i < 6; i++) stepOnce() // entrada en i4, relleno en i5

    const log = screen.getByTestId('replay-log')
    expect(log).toHaveTextContent('StrategyConfirmed')
    expect(log).toHaveTextContent('Orden enviada: comprar')
    expect(log).toHaveTextContent('PositionOpened')
    expect(log).toHaveTextContent('Compra rellenada:')
    expect(screen.getByTestId('replay-position')).not.toHaveTextContent('sin posición')
  })

  it('Reproducir avanza con el temporizador (1× = tiempo real) y Pausar detiene', () => {
    vi.useFakeTimers()
    renderPanel()
    startSession()

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }))
    act(() => {
      vi.advanceTimersByTime(3_600_000) // 1× con velas de 1 h
    })
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('1 / 9 velas')
    act(() => {
      vi.advanceTimersByTime(3_600_000)
    })
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('2 / 9 velas')

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    act(() => {
      vi.advanceTimersByTime(10_000_000)
    })
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('2 / 9 velas')
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument()
  })

  it('la velocidad cambia el intervalo (3600× = 1 s por vela)', () => {
    vi.useFakeTimers()
    renderPanel()
    startSession()
    fireEvent.change(screen.getByLabelText('Velocidad'), { target: { value: '3600' } })

    fireEvent.click(screen.getByRole('button', { name: 'Reproducir' }))
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByTestId('replay-progress')).toHaveTextContent('1 / 9 velas')
  })

  it('al procesar todas las velas la sesión termina', () => {
    renderPanel()
    startSession()
    for (let i = 0; i < 9; i++) stepOnce()

    expect(screen.getByTestId('replay-progress')).toHaveTextContent('9 / 9 velas')
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Paso' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reiniciar' })).toBeEnabled()
  })

  it('Reiniciar vuelve al inicio con el log vacío', () => {
    const { onProgress } = renderPanel()
    startSession()
    stepOnce()
    stepOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))

    expect(screen.getByTestId('replay-progress')).toHaveTextContent('0 / 9 velas')
    expect(screen.getByTestId('replay-log')).toBeEmptyDOMElement()
    expect(onProgress).toHaveBeenLastCalledWith(0)
  })

  it('si cambian las velas se descarta la sesión y se limpia el progreso', () => {
    const { rerender, onProgress } = renderPanel()
    startSession()
    expect(screen.getByTestId('replay-progress')).toBeInTheDocument()

    rerender(
      <ReplayPanel
        candles={[
          ...CANDLES,
          Candle.from({
            time: t0 + CANDLES.length * stepMs,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1,
          }),
        ]}
        timeframe={Timeframe.HOUR}
        strategy={SPEC}
        onProgress={onProgress}
      />,
    )

    expect(screen.queryByTestId('replay-progress')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(onProgress).toHaveBeenLastCalledWith(null)
  })
})

describe('ReplayPanel — operaciones manuales', () => {
  it('comprar abre posición en el siguiente paso y bloquea mientras hay orden en vuelo', () => {
    renderPanel()
    startSession()

    expect(screen.getByRole('button', { name: 'Vender' })).toBeDisabled() // sin posición

    fireEvent.click(screen.getByRole('button', { name: 'Comprar' }))
    expect(screen.getByTestId('replay-pending')).toHaveTextContent(/^1$/)
    expect(screen.getByRole('button', { name: 'Comprar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Vender' })).toBeDisabled()

    stepOnce() // rellena en la apertura de la siguiente vela
    expect(screen.getByTestId('replay-pending')).toHaveTextContent(/^0$/)
    expect(screen.getByTestId('replay-position')).not.toHaveTextContent('sin posición')
    expect(screen.getByRole('button', { name: 'Comprar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Vender' })).toBeEnabled()
  })

  it('la fracción debe ser un entero entre 1 y 100', () => {
    renderPanel()
    startSession()
    const buy = screen.getByRole('button', { name: 'Comprar' })

    fireEvent.change(screen.getByLabelText('Fracción (%)'), { target: { value: '0' } })
    expect(buy).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Fracción (%)'), { target: { value: '150' } })
    expect(buy).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Fracción (%)'), { target: { value: '2.5' } })
    expect(buy).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Fracción (%)'), { target: { value: '25' } })
    expect(buy).toBeEnabled()
  })
})
