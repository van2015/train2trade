import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StrategyEditor } from '@/components/StrategyEditor'
import { Candle } from '@/domain/candles/candle'
import { minus, series } from '@/domain/strategies/priceExpr'
import { StrategySpec } from '@/domain/strategies/spec'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Velas crecientes: la media (SMA) queda por debajo del último cierre. */
const CANDLES: Candle[] = Array.from({ length: 40 }, (_, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1,
  }),
)

const SPEC: StrategySpec = {
  name: 'demo',
  version: 1,
  indicators: [
    { alias: 'fast', kind: 'sma', period: 10 },
    { alias: 'r', kind: 'rsi', period: 14 },
    { alias: 'umbral', kind: 'const', value: 30 },
  ],
  entry: { rule: { kind: 'condition', op: '>', a: 'close', b: 'fast' }, execution: 'market' },
}

function renderEditor(initial: StrategySpec = SPEC, candles: Candle[] = CANDLES) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <StrategyEditor
      title="Editar demo@1"
      spec={initial}
      candles={candles}
      error={null}
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  return { onSave, onCancel }
}

function saved(onSave: ReturnType<typeof vi.fn>): StrategySpec {
  const spec = onSave.mock.calls[0]?.[0] as StrategySpec | undefined
  if (spec === undefined) throw new Error('onSave no fue llamado')
  return spec
}

describe('StrategyEditor — indicadores (§1.8)', () => {
  it('los tres grupos pintan sus filas con alias, tipo y parámetro', () => {
    renderEditor()

    expect(screen.getByLabelText('Indicador 1 alias')).toHaveValue('fast')
    expect(screen.getByLabelText('Indicador 1 periodo')).toHaveValue(10)
    expect(screen.getByLabelText('Indicador 2 tipo')).toHaveValue('rsi')
    expect(screen.getByLabelText('Indicador 3 valor')).toHaveValue(30)
    expect(screen.getByTestId('indicators-price')).toBeInTheDocument()
    expect(screen.getByTestId('indicators-oscillator')).toBeInTheDocument()
    expect(screen.getByTestId('indicators-constant')).toBeInTheDocument()
  })

  it('editar periodo y alias llega al spec guardado', () => {
    const { onSave } = renderEditor()

    fireEvent.change(screen.getByLabelText('Indicador 1 periodo'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Indicador 1 alias'), { target: { value: 'media' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saved(onSave).indicators[0]).toEqual({ alias: 'media', kind: 'sma', period: 12 })
  })

  it('añadir por grupo crea el tipo por defecto y quitar lo elimina', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Añadir oscilador'))
    fireEvent.change(screen.getByLabelText('Indicador 4 alias'), { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).indicators).toHaveLength(4)
    expect(saved(onSave).indicators[3]).toEqual({ alias: 'r2', kind: 'rsi', period: 14 })

    fireEvent.click(screen.getByLabelText('Quitar indicador 4'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave.mock.calls[1]?.[0].indicators).toHaveLength(3)
  })

  it('cambiar el tipo conmuta el parámetro (periodo ⇄ valor)', () => {
    const { onSave } = renderEditor()

    fireEvent.change(screen.getByLabelText('Indicador 1 tipo'), { target: { value: 'const' } })

    expect(screen.queryByLabelText('Indicador 1 periodo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Indicador 1 valor')).toHaveValue(30)

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).indicators[0]).toEqual({ alias: 'fast', kind: 'const', value: 30 })
  })
})

describe('StrategyEditor — entrada', () => {
  it('market → sin expresión de precio; limit → aparece y se edita en forma plana', () => {
    const { onSave } = renderEditor()

    expect(screen.queryByTestId('entry-price')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Ejecución de entrada'), { target: { value: 'limit' } })
    expect(screen.getByTestId('entry-price')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Añadir término a Precio de entrada'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const entry = saved(onSave).entry
    expect(entry.execution).toBe('limit')
    if (entry.execution === 'limit') {
      expect(entry.price).toEqual(minus(series('close'), series('close')))
    }
  })

  it('volver a market elimina la expresión de precio', () => {
    const limited: StrategySpec = {
      ...SPEC,
      entry: { rule: SPEC.entry.rule, execution: 'limit', price: series('fast') },
    }
    const { onSave } = renderEditor(limited)

    fireEvent.change(screen.getByLabelText('Ejecución de entrada'), { target: { value: 'market' } })
    expect(screen.queryByTestId('entry-price')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    const entry = saved(onSave).entry
    expect(entry).toEqual({ rule: SPEC.entry.rule, execution: 'market' })
    expect('price' in entry).toBe(false)
  })

  it('la regla de entrada se edita con el árbol (operandos filtrados por clase)', () => {
    const { onSave } = renderEditor()
    const tree = within(screen.getByTestId('entry-rule'))

    expect(tree.getByLabelText('Regla de entrada operando a')).toHaveValue('close')
    const secondOptions = within(tree.getByLabelText('Regla de entrada operando b'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
    expect(secondOptions).toContain('umbral')
    expect(secondOptions).not.toContain('r') // oscilador incompatible con price

    fireEvent.change(tree.getByLabelText('Regla de entrada operando a'), {
      target: { value: 'umbral' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(saved(onSave).entry.rule).toEqual({ kind: 'condition', op: '>', a: 'umbral', b: 'fast' })
  })

  it('el atajo de constante añade el indicador y lo asigna al operando (riesgo §1.8)', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Regla de entrada operando a añadir constante'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const spec = saved(onSave)
    expect(spec.indicators).toHaveLength(4)
    expect(spec.indicators[3]).toEqual({ alias: 'c1', kind: 'const', value: 30 })
    expect(spec.entry.rule).toEqual({ kind: 'condition', op: '>', a: 'c1', b: 'fast' })
  })
})

describe('StrategyEditor — TP/SL', () => {
  it('activar/desactivar Take profit añade o elimina el nivel', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Take profit'))
    expect(screen.getByTestId('takeProfit-price')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Añadir término a Take profit precio'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).takeProfit).toEqual({
      price: minus(series('close'), series('close')),
      execution: 'market',
    })

    fireEvent.click(screen.getByLabelText('Take profit')) // desactivar
    expect(screen.queryByTestId('takeProfit-price')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect('takeProfit' in (onSave.mock.calls[1]?.[0] as StrategySpec)).toBe(false)
  })

  it('la expresión del TP admite el alias entry (contexto §1.1)', () => {
    renderEditor()

    fireEvent.click(screen.getByLabelText('Stop loss'))
    const options = within(screen.getByTestId('stopLoss'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
    expect(options).toContain('entry')
    expect(options).not.toContain('sl') // sin auto-referencia
    expect(options).not.toContain('r') // oscilador no forma precios
  })

  it('avisa (sin bloquear) si el TP no queda por encima de la entrada (enmienda 16)', () => {
    const inverted: StrategySpec = {
      ...SPEC,
      entry: { rule: SPEC.entry.rule, execution: 'limit', price: series('close') },
      takeProfit: { price: series('close'), execution: 'market' },
    }
    const { onSave } = renderEditor(inverted)

    expect(screen.getByTestId('level-warning')).toHaveTextContent('Take profit')
    expect(screen.getByTestId('level-warning')).toHaveTextContent('dispararía al instante')

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave).toHaveBeenCalledTimes(1) // solo avisa: no bloquea
  })

  it('con niveles coherentes no hay aviso', () => {
    const sane: StrategySpec = {
      ...SPEC,
      entry: { rule: SPEC.entry.rule, execution: 'limit', price: series('close') },
      takeProfit: { price: series('high'), execution: 'market' },
      stopLoss: { price: series('low'), execution: 'market' },
    }
    renderEditor(sane)

    expect(screen.queryByTestId('level-warning')).not.toBeInTheDocument()
  })
})

describe('StrategyEditor — triggers (fraction solo en add/reduce)', () => {
  it('añadir crea un trigger de salida sin fracción', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Añadir trigger'))
    expect(screen.getByTestId('trigger-0')).toBeInTheDocument()
    expect(screen.queryByLabelText('Trigger 1 fracción')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).triggers).toEqual([
      { price: series('close'), action: 'request_exit', execution: 'market' },
    ])
  })

  it('al pasar a add/reduce aparece la fracción (0,1] con default 1', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Añadir trigger'))
    fireEvent.change(screen.getByLabelText('Trigger 1 acción'), {
      target: { value: 'request_add' },
    })

    expect(screen.getByLabelText('Trigger 1 fracción')).toHaveValue(1)
    fireEvent.change(screen.getByLabelText('Trigger 1 fracción'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).triggers?.[0]).toEqual({
      price: series('close'),
      action: 'request_add',
      execution: 'market',
      fraction: 0.5,
    })

    // Volver a salir retira la fracción.
    fireEvent.change(screen.getByLabelText('Trigger 1 acción'), {
      target: { value: 'request_exit' },
    })
    expect(screen.queryByLabelText('Trigger 1 fracción')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave.mock.calls[1]?.[0].triggers?.[0].fraction).toBeUndefined()
  })

  it('quitar el último trigger deja el campo ausente', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Añadir trigger'))
    fireEvent.click(screen.getByLabelText('Quitar trigger 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect('triggers' in saved(onSave)).toBe(false)
  })
})

describe('StrategyEditor — salida por regla y veto', () => {
  it('activar/desactivar cada regla opcional añade o elimina el árbol', () => {
    const { onSave } = renderEditor()

    fireEvent.click(screen.getByLabelText('Salida por regla'))
    fireEvent.click(screen.getByLabelText('Veto (invalidación)'))
    expect(screen.getByTestId('exit-rule')).toBeInTheDocument()
    expect(screen.getByTestId('invalidation-rule')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(saved(onSave).exitRule).toBeDefined()
    expect(saved(onSave).invalidation).toBeDefined()

    fireEvent.click(screen.getByLabelText('Salida por regla'))
    expect(screen.queryByTestId('exit-rule')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect('exitRule' in (onSave.mock.calls[1]?.[0] as StrategySpec)).toBe(false)
  })

  it('la regla de salida permite alias de operación (contexto §1.1)', () => {
    renderEditor()

    fireEvent.click(screen.getByLabelText('Salida por regla'))
    const tree = within(screen.getByTestId('exit-rule'))
    const options = within(tree.getByLabelText('Regla de salida operando a'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
    expect(options).toContain('entry')
    expect(options).toContain('sl')
  })
})

describe('StrategyEditor — deshacer', () => {
  it('deshacer revierte el último cambio y se deshabilita sin historial', () => {
    renderEditor()

    const undo = screen.getByRole('button', { name: 'Deshacer' })
    expect(undo).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'otro' } })
    expect(screen.getByLabelText('Nombre')).toHaveValue('otro')
    expect(undo).toBeEnabled()

    fireEvent.click(undo)
    expect(screen.getByLabelText('Nombre')).toHaveValue('demo')
    expect(undo).toBeDisabled()
  })
})
