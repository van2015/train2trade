import { useState } from 'react'
import type { StrategySpec } from '@/domain/strategies/spec'
import type { StrategyRepository, StrategySnapshot } from '@/storage/strategyRepository'

/** Catálogo de estrategias: selección única (§1.9), editor y arranque tolerante. */
export interface StrategyCatalogSlice {
  /** Estrategias persistidas (snapshot con `id`), en el orden del repositorio. */
  strategies: readonly StrategySnapshot[]
  /** Estrategia activa (selector único); null si la lista está vacía. */
  selected: StrategySpec | null
  /** `id` de la estrategia activa (resuelta; null si no hay ninguna). */
  selectedId: string | null
  /** Draft del editor abierto; null = editor cerrado (muestra el chart normal). */
  editingSpec: StrategySpec | null
  /** Claves ilegibles detectadas al arrancar (incidente 2026-11-15). */
  corrupted: readonly string[]
  /** Repositorio inyectado (lo usa el panel de CRUD de estrategias). */
  repository: StrategyRepository
  onSelectedChange: (id: string) => void
  onEditingChange: (spec: StrategySpec | null) => void
  /** Elimina las claves corruptas, re-siembra la demo si no queda nada y refresca. */
  onRepair: () => void
  /** Tras el CRUD (§1.8): la lista y la selección se recalculan. */
  reload: () => void
}

export interface UseStrategyCatalogOptions {
  strategies: StrategyRepository
  /** Al abrir el editor (null → spec): la pestaña Gráfico muestra el preview. */
  onEditingOpened: () => void
}

/**
 * Catálogo de estrategias persistidas. Si la seleccionada se borra, la
 * selección cae en la primera de la lista. El ciclo de edición (§1.8) notifica
 * `onEditingOpened` solo al **abrir**: cambios de draft y cierre no tocan la
 * pestaña (el usuario puede navegar mientras edita).
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
