import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { isSidebarSectionId, SidebarSection } from '@/components/SidebarSection'

/** Hijo con estado local para demostrar que plegar no desmonta el contenido. */
function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((current) => current + 1)}>{count}</button>
}

function renderSection(open: boolean, onToggle = vi.fn()) {
  render(
    <SidebarSection id="datos" title="Datos" open={open} onToggle={onToggle}>
      <Counter />
    </SidebarSection>,
  )
  return onToggle
}

describe('SidebarSection', () => {
  it('expone el estado en aria-expanded y controla el contenido con aria-controls', () => {
    renderSection(false)

    const header = screen.getByRole('button', { name: 'Datos' })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveAttribute('aria-controls', 'datos-content')
    expect(document.getElementById('datos-content')).toHaveAttribute('hidden')
    expect(document.getElementById('datos-content')).not.toBeVisible()
  })

  it('con la sección abierta el contenido es visible', () => {
    renderSection(true)

    expect(screen.getByRole('button', { name: 'Datos' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '0' })).toBeVisible()
    expect(document.getElementById('datos-content')).not.toHaveAttribute('hidden')
  })

  it('alterna la sección al pulsar la cabecera', () => {
    const onToggle = renderSection(false)

    fireEvent.click(screen.getByRole('button', { name: 'Datos' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith('datos')
  })

  it('el contenido cerrado sigue montado: el estado de los hijos sobrevive', () => {
    // Sección controlada por estado local (como en App) para poder alternar de verdad.
    function StatefulSection() {
      const [open, setOpen] = useState(true)
      return (
        <SidebarSection id="datos" title="Datos" open={open} onToggle={() => setOpen((o) => !o)}>
          <Counter />
        </SidebarSection>
      )
    }
    render(<StatefulSection />)

    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()

    // Cerrar: oculto para roles, pero sigue en el DOM (display:none, sin unmount).
    fireEvent.click(screen.getByRole('button', { name: 'Datos' }))
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
    expect(document.getElementById('datos-content')).toHaveAttribute('hidden')

    // Reabrir: el contador conserva su valor.
    fireEvent.click(screen.getByRole('button', { name: 'Datos' }))
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()
  })

  it('la cabecera expone solo el título (el chevron está oculto para a11y)', () => {
    renderSection(false)

    expect(screen.queryByRole('button', { name: '▸ Datos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Datos' })).toBeInTheDocument()
  })
})

describe('isSidebarSectionId', () => {
  it('acepta los ids conocidos y rechaza el resto', () => {
    expect(isSidebarSectionId('datos')).toBe(true)
    expect(isSidebarSectionId('experimentos')).toBe(true)

    // 'resultados' se eliminó en la Fase 3 (Historial es una pestaña):
    // un valor antiguo persistido cae al default 'datos' en App.
    expect(isSidebarSectionId('resultados')).toBe(false)
    expect(isSidebarSectionId('otra')).toBe(false)
    expect(isSidebarSectionId('')).toBe(false)
    expect(isSidebarSectionId(null)).toBe(false)
    expect(isSidebarSectionId(42)).toBe(false)
  })
})
