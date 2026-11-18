import { useState } from 'react'
import type { StrategySpec } from '@/domain/strategies/spec'
import type { StrategyRepository, StrategySnapshot } from '@/storage/strategyRepository'

export interface StrategyCatalogSlice {
  strategies: readonly StrategySnapshot[]
  /** Estrategia activa (§1.9); null si la lista está vacía. */
  selected: StrategySpec | null
  /** `id` ya resuelto de la activa: el estado crudo puede apuntar a una borrada. */
  selectedId: string | null
  /** Draft del editor; null = cerrado (la pestaña Gráfico muestra el chart normal). */
  editingSpec: StrategySpec | null
  /** Claves ilegibles detectadas al arrancar (incidente 2026-11-15). */
  corrupted: readonly string[]
  repository: StrategyRepository
  onSelectedChange: (id: string) => void
  onEditingChange: (spec: StrategySpec | null) => void
  onRepair: () => void
  reload: () => void
}

export interface UseStrategyCatalogOptions {
  strategies: StrategyRepository
  onEditingOpened: () => void
}

/**
 * Si la seleccionada se borra, la selección cae en la primera de la lista.
 * El ciclo de edición (§1.8) notifica `onEditingOpened` solo al **abrir**:
 * cambios de draft y cierre no tocan la pestaña (el usuario puede navegar
 * mientras edita).
 */
export function useStrategyCatalog({
  strategies,
  onEditingOpened,
}: UseStrategyCatalogOptions): StrategyCatalogSlice {
  const [list, setList] = useState<readonly StrategySnapshot[]>(() => strategies.list())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState<StrategySpec | null>(null)
  const [corrupted, setCorrupted] = useState<readonly string[]>(() => strategies.corruptedKeys())

  const selected = list.find((strategy) => strategy.id === selectedId) ?? list[0] ?? null

  const reload = () => setList(strategies.list())

  const onRepair = () => {
    strategies.repair()
    setCorrupted([])
    setList(strategies.list())
  }

  const onEditingChange = (spec: StrategySpec | null) => {
    const opening = spec !== null && editingSpec === null
    setEditingSpec(spec)
    if (opening) onEditingOpened()
  }

  return {
    strategies: list,
    selected,
    selectedId: selected?.id ?? null,
    editingSpec,
    corrupted,
    repository: strategies,
    onSelectedChange: setSelectedId,
    onEditingChange,
    onRepair,
    reload,
  }
}
