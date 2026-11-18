import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from '@/components/atoms/Field'

describe('Field', () => {
  it('por defecto envuelve el control en una label con el texto en un span', () => {
    render(
      <Field label="Capital inicial">
        <input data-testid="control" />
      </Field>,
    )

    const control = screen.getByTestId('control')
    const label = control.closest('label')
    expect(label).toHaveClass('field')
    expect(label?.querySelector('span')).toHaveTextContent('Capital inicial')
  })

  it('con htmlFor asocia un label externo al control por su id', () => {
    render(
      <Field htmlFor="fecha" label="Desde">
        <input id="fecha" data-testid="control" />
      </Field>,
    )

    const control = screen.getByTestId('control')
    expect(control.closest('label')).toBeNull()
    expect(control.parentElement).toHaveClass('field')
    expect(screen.getByLabelText('Desde')).toBe(control)
  })

  it('en variante check el control va dentro de la label y el texto después', () => {
    render(
      <Field check label="Cerrar posición al final">
        <input type="checkbox" data-testid="control" />
      </Field>,
    )

    const control = screen.getByTestId('control')
    const label = control.closest('label')
    expect(label?.parentElement).toHaveClass('field', 'field--check')
    expect(label?.textContent).toBe('Cerrar posición al final')
    expect(screen.getByLabelText('Cerrar posición al final')).toBe(control)
  })
})
