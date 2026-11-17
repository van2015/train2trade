import { useCallback, useState } from 'react'
import type { Experiment, ExperimentSnapshot } from '@/domain/backtest/experiment'
import type { ExperimentRepository } from '@/storage/experimentRepository'

/** Historial de experimentos: persistencia y CRUD (§9/§12C). */
export interface ExperimentStoreSlice {
  snapshots: readonly ExperimentSnapshot[]
  /** Auto-guardo tras cada ejecución: id determinístico → sobrescribe, sin duplicados. */
  onExperiment: (experiment: Experiment) => void
  onRemove: (ids: readonly string[]) => void
  onClear: () => void
}

/**
 * Experimentos persistidos en localStorage (Fase 6, §9). Cada escritura
 * refresca los snapshots que muestra la pestaña Historial.
 */
export function useExperimentStore({
  experiments,
}: {
  experiments: ExperimentRepository
}): ExperimentStoreSlice {
  const [snapshots, setSnapshots] = useState<readonly ExperimentSnapshot[]>(() =>
    experiments.list(),
  )
  const reload = useCallback(() => {
    setSnapshots(experiments.list())
  }, [experiments])

  const onExperiment = (experiment: Experiment) => {
    experiments.save(experiment.toSnapshot())
    reload()
  }

  const onRemove = (ids: readonly string[]) => {
    for (const id of ids) experiments.remove(id)
    reload()
  }

  const onClear = () => {
    experiments.clear()
    reload()
  }

  return { snapshots, onExperiment, onRemove, onClear }
}
