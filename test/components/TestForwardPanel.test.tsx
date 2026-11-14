import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TestForwardPanel, type TestForwardPanelProps } from '@/components/TestForwardPanel'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { StrategySpec } from '@/domain/strategies/spec'
import { TestForwardSession } from '@/domain/testforward/session'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E: cruce SMA(2)/SMA(3) al alza en i4 → punto de confirmación. */
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

function renderPanel(
  candles: readonly Candle[] = CANDLES,
  props: Partial<TestForwardPanelProps> = {},
) {
  const onStart = vi.fn()
  const { strategy = SPEC, ...rest } = props
  render(
    <TestForwardPanel
      candles={candles}
      timeframe={Timeframe.HOUR}
      strategy={strategy}
      onStart={onStart}
      {...rest}
    />,
  )
  return { onStart }
}

describe('TestForwardPanel — formulario (§2.3)', () => {
  it('sin velas → aviso y botón deshabilitado', () => {
    renderPanel([])

    expect(screen.getByTestId('tf-empty')).toHaveTextContent('descarga o importa')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  })

  it('sin estrategia activa → aviso y botón deshabilitado', () => {
    renderPanel(CANDLES, { strategy: null })

    expect(screen.getByTestId('tf-no-strategy')).toHaveTextContent('Estrategia')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  })

  it('la estrategia activa se muestra en el hint', () => {
    renderPanel()

    expect(screen.getByTestId('tf-strategy-hint')).toHaveTextContent('sma-cross@1')
  })

  it('capital inválido → error del formulario compartido, sin sesión', () => {
    const { onStart } = renderPanel()

    fireEvent.change(screen.getByLabelText('Capital inicial'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(screen.getByTestId('tf-error')).toHaveTextContent('Capital inicial')
    expect(onStart).not.toHaveBeenCalled()
  })

  it('iniciar crea la sesión con el salto inicial al azar (§2.1.2)', () => {
    const { onStart } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(onStart).toHaveBeenCalledTimes(1)
    const session = onStart.mock.calls[0]?.[0] as TestForwardSession
    expect(session).toBeInstanceOf(TestForwardSession)
    expect(session.points).toEqual([4]) // cruce SMA(2)/SMA(3) en i4
    expect(session.status).toBe('awaiting')
    expect(session.cursor).toBe(5)
    expect(screen.queryByTestId('tf-error')).not.toBeInTheDocument()
  })
})
