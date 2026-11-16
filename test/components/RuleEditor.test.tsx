import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { RuleEditor, defaultCondition } from '@/components/RuleEditor'
import { RuleSpec, SeriesClasses } from '@/domain/strategies/spec'

const CLASSES: SeriesClasses = {
  close: 'price',
  open: 'price',
  high: 'price',
  low: 'price',
  entry: 'price',
  sl: 'price',
  tp: 'price',
  fast: 'price',
  slow: 'price',
  rsi14: 'oscillator',
  umbral: 'constant',
}

const CONDITION: RuleSpec = { kind: 'condition', op: '>', a: 'close', b: 'open' }

function Harness({
  initial,
  operations = [],
  onChange,
  onAddConstant,
}: {
  initial: RuleSpec
  operations?: readonly string[]
  onChange?: (rule: RuleSpec) => void
  onAddConstant?: () => string
}) {
  const [value, setValue] = useState(initial)
  return (
    <RuleEditor
      testId="rule-editor"
      label="Regla"
      value={value}
      classes={CLASSES}
      operations={operations}
      onAddConstant={onAddConstant ?? (() => 'c1')}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function renderRule(
  initial: RuleSpec,
  operations?: readonly string[],
  onChange?: (r: RuleSpec) => void,
  onAddConstant?: () => string,
) {
  render(
    <Harness
      initial={initial}
      operations={operations}
      onChange={onChange}
      onAddConstant={onAddConstant}
    />,
  )
  return within(screen.getByTestId('rule-editor'))
}

function optionsOf(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((option) => (option as HTMLOptionElement).value)
}

describe('RuleEditor — condición (operador y operandos)', () => {
  it('pinta operador y operandos con los valores actuales', () => {
    const container = renderRule(CONDITION)

    expect(container.getByLabelText('Regla operador')).toHaveValue('>')
    expect(container.getByLabelText('Regla operando a')).toHaveValue('close')
    expect(container.getByLabelText('Regla operando b')).toHaveValue('open')
  })

  it('cambiar el operador o un operando emite la regla actualizada', () => {
    const onChange = vi.fn()
    const container = renderRule(CONDITION, undefined, onChange)

    fireEvent.change(container.getByLabelText('Regla operador'), { target: { value: '<' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...CONDITION, op: '<' })

    fireEvent.change(container.getByLabelText('Regla operando a'), { target: { value: 'fast' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...CONDITION, op: '<', a: 'fast' })
  })

  it('ofrece el operador "es igual a" (==) y lo emite al elegirlo', () => {
    const onChange = vi.fn()
    const container = renderRule(CONDITION, undefined, onChange)

    expect(optionsOf(container.getByLabelText('Regla operador'))).toContain('==')

    fireEvent.change(container.getByLabelText('Regla operador'), { target: { value: '==' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...CONDITION, op: '==' })
  })

  it('el segundo operando solo ofrece aliados compatibles: misma clase o constante', () => {
    const container = renderRule(CONDITION) // a = close (price)

    const second = optionsOf(container.getByLabelText('Regla operando b'))
    expect(second).toContain('fast') // price
    expect(second).toContain('umbral') // constant
    expect(second).not.toContain('rsi14') // oscillator ≠ price
    expect(second).not.toContain('close') // distinto de `a`

    fireEvent.change(container.getByLabelText('Regla operando a'), { target: { value: 'rsi14' } })
    const oscillatorSecond = optionsOf(container.getByLabelText('Regla operando b'))
    expect(oscillatorSecond).toContain('umbral')
    expect(oscillatorSecond).not.toContain('rsi14') // distinto de `a`
    expect(oscillatorSecond).not.toContain('close')
    expect(oscillatorSecond).not.toContain('fast')
  })

  it('al cambiar `a`, un `b` incompatible se reajusta a un aliado', () => {
    const onChange = vi.fn()
    const container = renderRule(
      { kind: 'condition', op: '>', a: 'close', b: 'fast' },
      undefined,
      onChange,
    )

    fireEvent.change(container.getByLabelText('Regla operando a'), { target: { value: 'rsi14' } })

    const emitted = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'condition' }>
    expect(emitted.a).toBe('rsi14')
    expect(emitted.b).not.toBe('fast') // price incomp. con oscillator
    expect(['rsi14', 'umbral']).toContain(emitted.b)
  })

  it('sin alias de operación en el contexto → no aparecen', () => {
    const container = renderRule(CONDITION, [])
    expect(optionsOf(container.getByLabelText('Regla operando a'))).not.toContain('entry')
    expect(optionsOf(container.getByLabelText('Regla operando b'))).not.toContain('sl')
  })

  it('con los tres alias permitidos → aparecen en los operandos', () => {
    const container = renderRule(CONDITION, ['entry', 'sl', 'tp'])
    expect(optionsOf(container.getByLabelText('Regla operando a'))).toContain('entry')
    expect(optionsOf(container.getByLabelText('Regla operando b'))).toContain('sl')
  })
})

describe('RuleEditor — grupos AND/OR y NOT (decisión 11)', () => {
  it('añadir condición y quitar dentro de un grupo', () => {
    const onChange = vi.fn()
    const group: RuleSpec = { kind: 'and', rules: [CONDITION] }
    const container = renderRule(group, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla añadir condición'))
    const added = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'and' }>
    expect(added.rules).toHaveLength(2)

    // Quitar la segunda condición vuelve a una.
    fireEvent.click(container.getByLabelText('Regla/2 quitar'))
    const removed = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'and' }>
    expect(removed.rules).toHaveLength(1)
    expect(removed.rules[0]).toEqual(CONDITION)
  })

  it('añadir grupo anida un AND con una condición plantilla', () => {
    const onChange = vi.fn()
    const container = renderRule({ kind: 'and', rules: [CONDITION] }, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla añadir grupo'))

    const added = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'and' }>
    expect(added.rules).toHaveLength(2)
    const nested = added.rules[1]
    expect(nested?.kind).toBe('and')
    if (nested?.kind === 'and') {
      expect(nested.rules).toHaveLength(1)
      expect(nested.rules[0]?.kind).toBe('condition')
    }
  })

  it('NOT envuelve el nodo', () => {
    const onChange = vi.fn()
    const container = renderRule(CONDITION, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla alternar NOT'))

    expect(onChange).toHaveBeenLastCalledWith({ kind: 'not', rule: CONDITION })
  })

  it('el botón desenvuelve un NOT y pinta la condición interna', () => {
    const onChange = vi.fn()
    const container = renderRule({ kind: 'not', rule: CONDITION }, undefined, onChange)

    expect(container.getByLabelText('Regla operador')).toHaveValue('>')

    fireEvent.click(container.getByLabelText('Regla alternar NOT'))
    expect(onChange).toHaveBeenLastCalledWith(CONDITION)
  })

  it('la raíz no tiene botón de quitar', () => {
    const container = renderRule(CONDITION)
    expect(container.queryByLabelText('Regla quitar')).not.toBeInTheDocument()
  })
})

describe('RuleEditor — first_since (primera vez desde que)', () => {
  const FIRST_SINCE: RuleSpec = {
    kind: 'first_since',
    since: { kind: 'condition', op: '==', a: 'fast', b: 'slow' },
    then: { kind: 'condition', op: '>', a: 'close', b: 'slow' },
  }

  it('pinta el nodo con sus dos ranuras y sus condiciones', () => {
    const container = renderRule(FIRST_SINCE)

    expect(container.getByTestId('Regla-first-since')).toBeInTheDocument()
    expect(container.getByText('Primera vez desde que…')).toBeInTheDocument()
    expect(container.getByText('desde que (ancla)')).toBeInTheDocument()
    expect(container.getByText('se cumple (primera vez)')).toBeInTheDocument()

    expect(container.getByLabelText('Regla-since operador')).toHaveValue('==')
    expect(container.getByLabelText('Regla-since operando a')).toHaveValue('fast')
    expect(container.getByLabelText('Regla-then operador')).toHaveValue('>')
    expect(container.getByLabelText('Regla-then operando b')).toHaveValue('slow')
  })

  it('editar la ranura del ancla emite el nodo con esa rama actualizada', () => {
    const onChange = vi.fn()
    const container = renderRule(FIRST_SINCE, undefined, onChange)

    fireEvent.change(container.getByLabelText('Regla-since operador'), { target: { value: '<' } })

    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'first_since',
      since: { kind: 'condition', op: '<', a: 'fast', b: 'slow' },
      then: FIRST_SINCE.then,
    })
  })

  it('editar la ranura de la condición emite el nodo con esa rama actualizada', () => {
    const onChange = vi.fn()
    const container = renderRule(FIRST_SINCE, undefined, onChange)

    fireEvent.change(container.getByLabelText('Regla-then operando b'), {
      target: { value: 'fast' },
    })

    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'first_since',
      since: FIRST_SINCE.since,
      then: { kind: 'condition', op: '>', a: 'close', b: 'fast' },
    })
  })

  it('las ranuras son obligatorias: tienen NOT pero no botón de quitar', () => {
    const container = renderRule(FIRST_SINCE)

    expect(container.getByLabelText('Regla-since alternar NOT')).toBeInTheDocument()
    expect(container.getByLabelText('Regla-then alternar NOT')).toBeInTheDocument()
    expect(container.queryByLabelText('Regla-since quitar')).not.toBeInTheDocument()
    expect(container.queryByLabelText('Regla-then quitar')).not.toBeInTheDocument()
  })

  it('NOT envuelve el nodo completo', () => {
    const onChange = vi.fn()
    const container = renderRule(FIRST_SINCE, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla alternar NOT'))

    expect(onChange).toHaveBeenLastCalledWith({ kind: 'not', rule: FIRST_SINCE })
  })

  it('el botón desenvuelve un NOT sobre el nodo', () => {
    const onChange = vi.fn()
    const container = renderRule({ kind: 'not', rule: FIRST_SINCE }, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla alternar NOT'))

    expect(onChange).toHaveBeenLastCalledWith(FIRST_SINCE)
  })

  it('envuelve una condición existente con "+ primera desde que"', () => {
    const onChange = vi.fn()
    const container = renderRule(CONDITION, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla envolver en primera vez desde que'))

    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'first_since',
      since: defaultCondition(),
      then: CONDITION,
    })
  })

  it('desde un grupo, "+ primera desde que" añade el nodo con las dos ramas plantilla', () => {
    const onChange = vi.fn()
    const container = renderRule({ kind: 'and', rules: [CONDITION] }, undefined, onChange)

    fireEvent.click(container.getByLabelText('Regla añadir primera desde que'))

    const added = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'and' }>
    expect(added.rules).toHaveLength(2)
    const node = added.rules[1]
    expect(node?.kind).toBe('first_since')
    if (node?.kind === 'first_since') {
      expect(node.since).toEqual(defaultCondition())
      expect(node.then).toEqual(defaultCondition())
    }
  })

  it('quitar el nodo desde el grupo lo elimina sin tocar el resto', () => {
    const onChange = vi.fn()
    const container = renderRule(
      { kind: 'and', rules: [CONDITION, FIRST_SINCE] },
      undefined,
      onChange,
    )

    fireEvent.click(container.getByLabelText('Regla/2 quitar'))

    const removed = onChange.mock.calls.at(-1)?.[0] as Extract<RuleSpec, { kind: 'and' }>
    expect(removed.rules).toEqual([CONDITION])
  })
})

describe('RuleEditor — atajo de constante junto a los operandos (riesgo §1.8)', () => {
  it('el botón llama al atajo y asigna el alias devuelto al operando', () => {
    const onAddConstant = vi.fn(() => 'c1')
    const onChange = vi.fn()
    const container = renderRule(CONDITION, undefined, onChange, onAddConstant)

    fireEvent.click(container.getByLabelText('Regla operando a añadir constante'))

    expect(onAddConstant).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({ ...CONDITION, a: 'c1' })

    fireEvent.click(container.getByLabelText('Regla operando b añadir constante'))
    expect(onChange).toHaveBeenLastCalledWith({ ...CONDITION, a: 'c1', b: 'c1' })
  })
})
