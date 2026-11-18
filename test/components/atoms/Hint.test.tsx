import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hint } from '@/components/atoms/Hint'

describe('Hint', () => {
  it('renderiza un párrafo con la clase panel-hint, su contenido y su testid', () => {
    render(<Hint data-testid="vacio">Sin datos todavía</Hint>)

    const hint = screen.getByTestId('vacio')
    expect(hint.tagName).toBe('P')
    expect(hint).toHaveClass('panel-hint')
    expect(hint).toHaveTextContent('Sin datos todavía')
  })
})
