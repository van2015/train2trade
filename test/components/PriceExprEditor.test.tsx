import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PriceExprEditor } from '@/components/PriceExprEditor'
import { dividedBy, minus, plus, PriceExpr, series, times } from '@/domain/strategies/priceExpr'

const OPTIONS = ['close', 'fast', 'slow', 'umbral', 'entry']

function Harness({
  initial,
  options = OPTIONS,
  onChange,
}: {
  initial: PriceExpr
  options?: readonly string[]
  onChange?: (expr: PriceExpr) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PriceExprEditor
      id="expr"
      label="Precio de entrada"
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function renderEditor(
  initial: PriceExpr,
  options?: readonly string[],
  onChange?: (e: PriceExpr) => void,
) {
  render(<Harness initial={initial} options={options} onChange={onChange} />)
  return within(screen.getByTestId('expr'))
}

function field(container: ReturnType<typeof within>, name: string): HTMLElement {
  return container.getByLabelText(name)
}

describe('PriceExprEditor — forma plana suma de productos (enmienda 15)', () => {
  it('serie única → un factor, sin signo ni quitar término', () => {
    const container = renderEditor(series('fast'))

    expect(field(container, 'Precio de entrada término 1 factor 1')).toHaveValue('fast')
    expect(container.queryByLabelText(/signo/)).not.toBeInTheDocument()
    expect(container.queryByLabelText(/quitar término/)).not.toBeInTheDocument()
    expect(
      container.getByLabelText('Precio de entrada término 1 añadir factor'),
    ).toBeInTheDocument()
    expect(container.getByLabelText('Añadir término a Precio de entrada')).toBeInTheDocument()
  })

  it('suma → términos con signo; cambiar el signo emite la resta', () => {
    const onChange = vi.fn()
    const container = renderEditor(plus(series('fast'), series('slow')), undefined, onChange)

    expect(field(container, 'Precio de entrada término 2 factor 1')).toHaveValue('slow')
    expect(field(container, 'Precio de entrada término 2 signo')).toHaveValue('+')

    fireEvent.change(field(container, 'Precio de entrada término 2 signo'), {
      target: { value: '-' },
    })

    expect(onChange).toHaveBeenLastCalledWith(minus(series('fast'), series('slow')))
  })

  it('añadir factor convierte el término en producto (izquierda asociativa)', () => {
    const onChange = vi.fn()
    const container = renderEditor(series('fast'), undefined, onChange)

    fireEvent.click(container.getByLabelText('Precio de entrada término 1 añadir factor'))

    expect(onChange).toHaveBeenLastCalledWith(times(series('fast'), series('close')))
    expect(field(container, 'Precio de entrada término 1 factor 2')).toHaveValue('close')
  })

  it('quitar factor deja el resto del producto', () => {
    const onChange = vi.fn()
    const container = renderEditor(times(series('fast'), series('slow')), undefined, onChange)

    fireEvent.click(container.getByLabelText('Precio de entrada término 1 quitar factor 2'))

    expect(onChange).toHaveBeenLastCalledWith(series('fast'))
  })

  it('añadir término agrega uno con signo menos', () => {
    const onChange = vi.fn()
    const container = renderEditor(series('fast'), undefined, onChange)

    fireEvent.click(container.getByLabelText('Añadir término a Precio de entrada'))

    expect(onChange).toHaveBeenLastCalledWith(minus(series('fast'), series('close')))
    expect(field(container, 'Precio de entrada término 2 signo')).toHaveValue('-')
  })

  it('quitar término elimina el último', () => {
    const onChange = vi.fn()
    const container = renderEditor(plus(series('fast'), series('slow')), undefined, onChange)

    fireEvent.click(container.getByLabelText('Precio de entrada quitar término 2'))

    expect(onChange).toHaveBeenLastCalledWith(series('fast'))
    expect(container.queryByLabelText(/quitar término/)).not.toBeInTheDocument()
  })

  it('factor actual fuera de las opciones → se muestra igual (select controlado)', () => {
    const container = renderEditor(series('borrado'), ['close', 'fast'])

    expect(field(container, 'Precio de entrada término 1 factor 1')).toHaveValue('borrado')
  })
})

describe('PriceExprEditor — expresiones no representables (enmienda 15)', () => {
  it('división → aviso "no editable" y sin controles de términos', () => {
    const container = renderEditor(dividedBy(series('fast'), series('slow')))

    expect(container.getByTestId('expr-unportable')).toHaveTextContent('no editable')
    expect(container.queryByLabelText(/Añadir término/)).not.toBeInTheDocument()
    expect(container.queryByLabelText(/factor/)).not.toBeInTheDocument()
  })
})
