import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MainTabs } from '@/components/MainTabs'

describe('MainTabs', () => {
  it('renderiza las pestañas con la activa seleccionada', () => {
    render(<MainTabs active="chart" onChange={vi.fn()} hasResult={false} />)

    expect(screen.getByRole('tablist', { name: 'Vistas del área principal' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Backtest' })).toHaveAttribute('aria-selected', 'false')
  })

  it('notifica el cambio de pestaña', () => {
    const onChange = vi.fn()
    render(<MainTabs active="chart" onChange={onChange} hasResult={false} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Backtest' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('backtest')
  })

  it('refleja la pestaña activa al re-renderizar', () => {
    const { rerender } = render(<MainTabs active="chart" onChange={vi.fn()} hasResult={false} />)

    rerender(<MainTabs active="backtest" onChange={vi.fn()} hasResult={false} />)

    expect(screen.getByRole('tab', { name: 'Gráfico' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Backtest' })).toHaveAttribute('aria-selected', 'true')
  })

  it('marca la pestaña Backtest con un indicador cuando hay resultados', () => {
    const { rerender } = render(<MainTabs active="chart" onChange={vi.fn()} hasResult={false} />)
    expect(screen.queryByTestId('main-tabs-dot')).not.toBeInTheDocument()

    rerender(<MainTabs active="chart" onChange={vi.fn()} hasResult={true} />)
    expect(screen.getByTestId('main-tabs-dot')).toBeInTheDocument()
  })
})
