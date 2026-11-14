import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StrategySelect } from '@/components/StrategySelect'
import type { StrategySpec } from '@/domain/strategies/spec'
import type { StrategySnapshot } from '@/storage/strategyRepository'

function spec(name: string, version: number): StrategySpec {
  return {
    name,
    version,
    indicators: [],
    entry: { rule: { kind: 'condition', op: '>', a: 'close', b: 'open' }, execution: 'market' },
  }
}

const STRATEGIES: StrategySnapshot[] = [
  { id: 'id-alpha', ...spec('alpha', 1) },
  { id: 'id-beta', ...spec('beta', 2) },
]

describe('StrategySelect — selector único de la estrategia activa (§1.9)', () => {
  it('lista cada estrategia como name@version y selecciona la dada', () => {
    render(<StrategySelect strategies={STRATEGIES} selectedId="id-beta" onChange={vi.fn()} />)

    const select = screen.getByRole('combobox', { name: 'Estrategia' })
    expect(select).toHaveValue('id-beta')
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['alpha@1', 'beta@2'])
  })

  it('cambiar la selección emite el id por onChange', () => {
    const onChange = vi.fn()
    render(<StrategySelect strategies={STRATEGIES} selectedId="id-alpha" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Estrategia' }), {
      target: { value: 'id-beta' },
    })

    expect(onChange).toHaveBeenCalledWith('id-beta')
  })

  it('sin estrategias → hint en lugar del selector', () => {
    render(<StrategySelect strategies={[]} selectedId={null} onChange={vi.fn()} />)

    expect(screen.getByTestId('strategy-select-empty')).toHaveTextContent('Sin estrategias')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('selectedId ausente (o de una estrategia borrada) → selecciona la primera', () => {
    render(<StrategySelect strategies={STRATEGIES} selectedId={null} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Estrategia' })).toHaveValue('id-alpha')
  })
})
