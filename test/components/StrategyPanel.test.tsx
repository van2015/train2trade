import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StrategyPanel } from '@/components/StrategyPanel'
import { StrategySpec } from '@/domain/strategies/spec'
import { StrategyRepository } from '@/storage/strategyRepository'

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

const ALPHA: StrategySpec = {
  name: 'alpha',
  version: 1,
  indicators: [{ alias: 'fast', kind: 'sma', period: 5 }],
  entry: { rule: { kind: 'condition', op: '>', a: 'close', b: 'fast' }, execution: 'market' },
}

const BETA: StrategySpec = { ...ALPHA, name: 'beta' }

/** Espejo de App: la lista vive en el padre y se refresca con `onChange`. */
function Harness({ repository }: { repository: StrategyRepository }) {
  const [list, setList] = useState(() => repository.list())
  return (
    <StrategyPanel
      strategies={list}
      repository={repository}
      candles={[]}
      onChange={() => setList(repository.list())}
    />
  )
}

function setup(...specs: StrategySpec[]) {
  const repository = new StrategyRepository(new MemoryStorage())
  for (const spec of specs) repository.save(spec)
  render(<Harness repository={repository} />)
  return repository
}

function rows() {
  return within(screen.getByTestId('strategy-list')).getAllByRole('row').slice(1)
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText('Nombre') as HTMLInputElement
}

describe('StrategyPanel — lista (§1.8)', () => {
  it('lista cada estrategia con name@version y fingerprint de 8 hex', () => {
    setup(ALPHA, BETA)

    const rowsList = rows()
    expect(rowsList).toHaveLength(2)
    expect(rowsList[0]).toHaveTextContent('alpha@1')
    expect(rowsList[1]).toHaveTextContent('beta@1')
    // La celda de huella es un hex de 8 dígitos (la misma que registra un Experiment).
    const fingerprint = rowsList[0]?.querySelectorAll('td')[1]?.textContent ?? ''
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/)
  })

  it('sin estrategias → hint; Nueva sigue disponible', () => {
    setup()

    expect(screen.getByTestId('strategy-empty')).toHaveTextContent('Sin estrategias')
    expect(screen.queryByTestId('strategy-list')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nueva estrategia' })).toBeEnabled()
  })
})

describe('StrategyPanel — nueva (enmienda 16: plantilla sma-cross)', () => {
  it('Nueva abre el editor con la plantilla (name vacío) y oculta la lista', () => {
    setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Nueva estrategia' }))

    expect(screen.getByTestId('strategy-editor')).toBeInTheDocument()
    expect(screen.getByText('Crear estrategia')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('')
    expect(screen.queryByTestId('strategy-list')).not.toBeInTheDocument()
  })

  it('guardar con el name vacío → error del dominio, el editor sigue abierto', () => {
    setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Nueva estrategia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByTestId('strategy-editor-error')).toHaveTextContent('name no puede estar')
    expect(screen.getByTestId('strategy-editor')).toBeInTheDocument()

    // Nada se guardó: al cancelar, la lista sigue intacta.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('alpha@1')
  })

  it('guardar válida → entra como versión 1 y cierra el editor', () => {
    const repository = setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Nueva estrategia' }))
    fireEvent.change(nameInput(), { target: { value: 'nueva' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByTestId('strategy-editor')).not.toBeInTheDocument()
    expect(repository.list().map((snapshot) => `${snapshot.name}@${snapshot.version}`)).toEqual([
      'alpha@1',
      'nueva@1',
    ]) // name ascendente
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('alpha@1'),
      expect.stringContaining('nueva@1'),
    ])
  })
})

describe('StrategyPanel — editar (enmienda 13: versión nueva conservando la anterior)', () => {
  it('Editar abre el editor con la spec precargada', () => {
    setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))

    expect(screen.getByTestId('strategy-editor')).toBeInTheDocument()
    expect(screen.getByText('Editar alpha@1')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('alpha')
  })

  it('editar y cambiar contenido → versión nueva; la anterior se conserva', () => {
    const repository = setup(ALPHA) // sma fast@5

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))
    fireEvent.change(screen.getByLabelText('Indicador 1 periodo'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(repository.list().map((snapshot) => `${snapshot.name}@${snapshot.version}`)).toEqual([
      'alpha@2',
      'alpha@1',
    ]) // version descendente
    const latest = repository.list().find((snapshot) => snapshot.version === 2)
    expect(latest?.indicators).toEqual([{ alias: 'fast', kind: 'sma', period: 7 }])
  })

  it('guardar sin cambios → no crea una versión nueva', () => {
    const repository = setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByTestId('strategy-editor')).not.toBeInTheDocument()
    expect(repository.list().map((snapshot) => snapshot.version)).toEqual([1])
    expect(rows()).toHaveLength(1)
  })

  it('guardar con el name cambiado → entrada nueva, la anterior se conserva', () => {
    const repository = setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))
    fireEvent.change(nameInput(), { target: { value: 'gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(repository.list().map((snapshot) => `${snapshot.name}@${snapshot.version}`)).toEqual([
      'alpha@1',
      'gamma@1',
    ])
  })

  it('guardar con una regla de clases inválidas → error de dominio, sin guardar', () => {
    // ALPHA: entry `close > fast` (price/price). Cambiar `fast` a RSI rompe
    // la clase de la condición → buildStrategy debe rechazarlo al guardar.
    const repository = setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))
    fireEvent.change(screen.getByLabelText('Indicador 1 tipo'), { target: { value: 'rsi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByTestId('strategy-editor-error')).toHaveTextContent('no se pueden comparar')
    expect(screen.getByTestId('strategy-editor')).toBeInTheDocument() // sigue abierto
    expect(repository.list()).toHaveLength(1)
    expect(repository.list()[0]?.indicators).toEqual([{ alias: 'fast', kind: 'sma', period: 5 }])
  })

  it('Cancelar cierra el editor sin guardar cambios', () => {
    const repository = setup(ALPHA)

    fireEvent.click(screen.getByRole('button', { name: 'Editar alpha@1' }))
    fireEvent.change(nameInput(), { target: { value: 'gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByTestId('strategy-editor')).not.toBeInTheDocument()
    expect(repository.list().map((snapshot) => snapshot.name)).toEqual(['alpha'])
  })
})

describe('StrategyPanel — borrar', () => {
  it('Borrar quita la estrategia de la lista y del repositorio', () => {
    const repository = setup(ALPHA, BETA)

    fireEvent.click(screen.getByRole('button', { name: 'Borrar alpha@1' }))

    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('beta@1')
    expect(repository.list().map((snapshot) => snapshot.name)).toEqual(['beta'])
  })
})
