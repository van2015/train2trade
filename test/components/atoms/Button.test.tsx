import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '@/components/atoms/Button'

describe('Button', () => {
  it('usa type="button" y la clase button por defecto', () => {
    render(<Button>Descargar</Button>)

    const button = screen.getByRole('button', { name: 'Descargar' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('button')
    expect(button).not.toHaveClass('button--ghost')
  })

  it('la variante ghost añade button--ghost sin tocar la clase base', () => {
    render(<Button variant="ghost">Cancelar</Button>)

    const button = screen.getByRole('button', { name: 'Cancelar' })
    expect(button).toHaveClass('button', 'button--ghost')
  })

  it('propaga onClick, disabled y data-testid', () => {
    const onClick = vi.fn()
    render(
      <>
        <Button data-testid="accion" onClick={onClick}>
          Ejecutar
        </Button>
        <Button disabled onClick={onClick}>
          Parar
        </Button>
      </>,
    )

    const activo = screen.getByTestId('accion')
    fireEvent.click(activo)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Parar' })).toBeDisabled()
  })
})
