import { useCallback, useState } from 'react'
import type { Experiment, ExperimentSnapshot } from '@/domain/backtest/experiment'
import type { ExperimentRepository } from '@/storage/experimentRepository'

export interface ExperimentStoreSlice {
  snapshots: readonly ExperimentSnapshot[]
  /** Auto-guardo (§9/§12C): id determinístico → re-ejecutar sobrescribe, sin duplicados. */
  onExperiment: (experiment: Experiment) => void
  onRemove: (ids: readonly string[]) => void
  onClear: () => void
}

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
