import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TestForwardSessionView } from '@/components/TestForwardSessionView'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { series } from '@/domain/strategies/priceExpr'
import { CrossesAbove, CrossesBelow, Greater } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { TradingSessionConfig } from '@/domain/trading/tradingSession'
import { TestForwardSession } from '@/domain/testforward/session'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E: cruce SMA(2)/SMA(3) al alza en i4 y a la baja en i7. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES: Candle[] = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'cross',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/** `close > SMA(3)`: puntos de confirmación en i4 e i5 (para saltos). */
function aboveStrategy(): Strategy {
  return new Strategy({
    name: 'above',
    indicators: { s: new Sma(3) },
    signals: [new Signal(StrategyAction.RequestEntry, new Greater('close', 's'))],
  })
}

/** Con TP declarado (§2.3: la UI solo muestra niveles que la estrategia declara). */
function tpStrategy(): Strategy {
  return new Strategy({
    name: 'tp',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
    takeProfit: { price: series('slow'), execution: 'market' },
  })
}

/** Nunca dispara → sin candidatos → finished. */
function neverStrategy(): Strategy {
  return new Strategy({
    name: 'never',
    signals: [new Signal(StrategyAction.RequestEntry, new Greater('close', 'close'))],
  })
}

function config(strategy: Strategy): TradingSessionConfig {
  return { strategy, candles: CANDLES, timeframe: Timeframe.HOUR, initialCapital: 1_000 }
}

function makeSession(strategy: Strategy = crossStrategy(), random: () => number = () => 0) {
  return new TestForwardSession(config(strategy), random)
}

function renderView(session: TestForwardSession | null, onProgress = vi.fn()) {
  const view = render(
    <TestForwardSessionView session={session} candles={CANDLES} onProgress={onProgress} />,
  )
  return { ...view, onProgress }
}

function startView(strategy?: Strategy, random?: () => number) {
  const session = makeSession(strategy, random)
  session.start()
  return renderView(session)
}

describe('TestForwardSessionView — estado y decisión (§2.3)', () => {
  it('sin sesión → aviso', () => {
    renderView(null)

    expect(screen.getByTestId('tf-session-empty')).toHaveTextContent('inicia un test-forward')
  })

  it('la sesión iniciada pinta progreso, decisión y cuenta', () => {
    startView()

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('5 / 9 velas')
    expect(screen.getByTestId('tf-progress')).toHaveTextContent('Esperando decisión')
    expect(screen.getByTestId('tf-decision')).toHaveTextContent('Entrada')
    expect(screen.getByRole('button', { name: 'Tomar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.getByTestId('tf-position')).toHaveTextContent('sin posición')
    expect(screen.getByTestId('tf-points')).toHaveTextContent('0')
    expect(screen.getByTestId('tf-log')).toHaveTextContent('Confirmación de entrada')
  })

  it('Tomar cierra la decisión y Paso avanza una vela', () => {
    const { onProgress } = startView()

    fireEvent.click(screen.getByTestId('tf-take'))

    expect(screen.queryByTestId('tf-decision')).not.toBeInTheDocument()
    expect(screen.getByTestId('tf-progress')).toHaveTextContent('En curso')
    expect(screen.getByTestId('tf-log')).toHaveTextContent('Entrada tomada')

    fireEvent.click(screen.getByTestId('tf-step'))

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('6 / 9 velas')
    expect(onProgress).toHaveBeenLastCalledWith(6)
  })

  it('Descartar no envía orden', () => {
    const session = makeSession()
    session.start()
    renderView(session)

    fireEvent.click(screen.getByTestId('tf-discard'))

    expect(session.session.broker.orders).toHaveLength(0)
    expect(screen.queryByTestId('tf-decision')).not.toBeInTheDocument()
    expect(screen.getByTestId('tf-log')).toHaveTextContent('descartada')
  })

  it('la salida por regla pausa con Cerrar/Mantener', () => {
    const { onProgress } = startView()

    fireEvent.click(screen.getByTestId('tf-take'))
    fireEvent.click(screen.getByTestId('tf-step')) // relleno de la entrada en i5
    fireEvent.click(screen.getByTestId('tf-jump')) // sin candidatos → corre hasta la salida de i7

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('Esperando decisión')
    expect(screen.getByTestId('tf-decision')).toHaveTextContent('Salida')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mantener' }))

    expect(screen.queryByTestId('tf-decision')).not.toBeInTheDocument()
    expect(screen.getByTestId('tf-position')).not.toHaveTextContent('sin posición')
    expect(onProgress).toHaveBeenLastCalledWith(8)
  })

  it('Saltar salta al siguiente punto aleatorio y Reiniciar vuelve al inicio', () => {
    const session = makeSession(aboveStrategy(), () => 0) // puntos [4, 5]
    session.start()
    const { onProgress } = renderView(session)

    fireEvent.click(screen.getByTestId('tf-discard')) // decide para poder saltar
    fireEvent.click(screen.getByTestId('tf-jump')) // destino i5

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('6 / 9 velas')
    expect(screen.getByTestId('tf-progress')).toHaveTextContent('Esperando decisión')
    expect(onProgress).toHaveBeenLastCalledWith(6)

    fireEvent.click(screen.getByTestId('tf-reset'))

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('0 / 9 velas')
    expect(screen.getByTestId('tf-progress')).toHaveTextContent('En curso')
    expect(onProgress).toHaveBeenLastCalledWith(0)
    expect(session.cursor).toBe(0)
  })

  it('en finished, Paso y Saltar quedan deshabilitados', () => {
    startView(neverStrategy())

    expect(screen.getByTestId('tf-progress')).toHaveTextContent('Terminado')
    expect(screen.getByTestId('tf-step')).toBeDisabled()
    expect(screen.getByTestId('tf-jump')).toBeDisabled()
    expect(screen.getByTestId('tf-reset')).toBeEnabled()
  })

  it('si cambian las velas la sesión se descarta (patrón Replay)', () => {
    const session = makeSession()
    session.start()
    const onProgress = vi.fn()
    const { rerender } = render(
      <TestForwardSessionView session={session} candles={CANDLES} onProgress={onProgress} />,
    )

    rerender(
      <TestForwardSessionView
        session={session}
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
        onProgress={onProgress}
      />,
    )

    expect(onProgress).toHaveBeenCalledWith(null)
  })
})

describe('TestForwardSessionView — controles de TP/SL (§2.3)', () => {
  it('solo muestra niveles que la estrategia declara (§1.5)', () => {
    startView(crossStrategy()) // sin TP/SL declarados

    expect(screen.queryByTestId('tf-tp')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tf-sl')).not.toBeInTheDocument()
  })

  it('fijar, revertir a auto y desactivar el TP', () => {
    const session = makeSession(tpStrategy())
    session.start()
    renderView(session)

    expect(screen.getByTestId('tf-tp')).toBeInTheDocument()
    expect(screen.getByTestId('tf-tp-value')).toHaveTextContent('Take profit:')

    // Manual (override numérico)
    fireEvent.change(screen.getByLabelText('Take profit precio manual'), {
      target: { value: '110' },
    })
    fireEvent.click(screen.getByLabelText('Fijar Take profit'))
    expect(session.levelOverrides.tp).toBe(110)
    expect(screen.getByTestId('tf-tp-value')).toHaveTextContent('(manual)')

    // Revertir a automático (la expresión de la estrategia manda)
    fireEvent.click(screen.getByLabelText('Take profit automático'))
    expect(session.levelOverrides.tp).toBeUndefined()
    expect(screen.getByTestId('tf-tp-value')).not.toHaveTextContent('(manual)')

    // Desactivar
    fireEvent.click(screen.getByLabelText('Desactivar Take profit'))
    expect(session.levelOverrides.tp).toBeNull()
    expect(screen.getByTestId('tf-tp-value')).toHaveTextContent('desactivado')
  })

  it('precio manual no numérico → error de sesión, sin tocar el nivel', () => {
    const session = makeSession(tpStrategy())
    session.start()
    renderView(session)

    fireEvent.change(screen.getByLabelText('Take profit precio manual'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByLabelText('Fijar Take profit'))

    expect(screen.getByTestId('tf-session-error')).toHaveTextContent('numérico')
    expect(session.levelOverrides.tp).toBeUndefined()
  })
})
