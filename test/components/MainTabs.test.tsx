import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MainTabs } from '@/components/MainTabs'

describe('MainTabs', () => {
  it('renderiza las seis pestañas con la activa seleccionada', () => {
    render(<MainTabs active="chart" onChange={vi.fn()} results={{}} />)

    expect(screen.getByRole('tablist', { name: 'Vistas del área principal' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Backtest' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Replay' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Test-Forward' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(screen.getByRole('tab', { name: 'Optimización' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'false')
  })

  it('notifica el cambio de pestaña', () => {
    const onChange = vi.fn()
    render(<MainTabs active="chart" onChange={onChange} results={{}} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Backtest' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('backtest')
  })

  it('refleja la pestaña activa al re-renderizar', () => {
    const { rerender } = render(<MainTabs active="chart" onChange={vi.fn()} results={{}} />)

    rerender(<MainTabs active="replay" onChange={vi.fn()} results={{}} />)

    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Replay' })).toHaveAttribute('aria-selected', 'true')
  })

  it('marca con un punto las pestañas que tienen resultados', () => {
    const { rerender } = render(
      <MainTabs active="chart" onChange={vi.fn()} results={{ backtest: true }} />,
    )
    expect(screen.getByTestId('main-tabs-dot-backtest')).toBeInTheDocument()
    expect(screen.queryByTestId('main-tabs-dot-optimization')).not.toBeInTheDocument()

    rerender(
      <MainTabs
        active="chart"
        onChange={vi.fn()}
        results={{ backtest: true, optimization: true }}
      />,
    )
    expect(screen.getByTestId('main-tabs-dot-optimization')).toBeInTheDocument()
    expect(screen.queryByTestId('main-tabs-dot-testforward')).not.toBeInTheDocument()
  })
})
