import { useState } from 'react'
import type { MainViewId } from '@/components/atoms/MainTabs'
import type { OptimizationViewState } from '@/components/organisms/OptimizationResults'
import type { Experiment } from '@/domain/backtest/experiment'

/** Pestaña activa del área principal + últimos resultados por pestaña. */
export interface MainViewSlice {
  view: MainViewId
  lastExperiment: Experiment | null
  lastOptimization: OptimizationViewState | null
  onChange: (view: MainViewId) => void
  openChart: () => void
  openTestForward: () => void
  onBacktestResult: (experiment: Experiment) => void
  onOptimizationResult: (view: OptimizationViewState) => void
}

/**
 * Navegación por estado (sin router) con auto-conmutación: ejecutar un
 * experimento abre su pestaña y abrir el editor vuelve al Gráfico.
 */
export function useMainView(): MainViewSlice {
  const [view, setView] = useState<MainViewId>('chart')
  const [lastExperiment, setLastExperiment] = useState<Experiment | null>(null)
  const [lastOptimization, setLastOptimization] = useState<OptimizationViewState | null>(null)

  const openChart = () => setView('chart')
  const openTestForward = () => setView('testforward')

  const onBacktestResult = (experiment: Experiment) => {
    setLastExperiment(experiment)
    setView('backtest')
  }

  const onOptimizationResult = (next: OptimizationViewState) => {
    setLastOptimization(next)
    setView('optimization')
  }

  return {
    view,
    lastExperiment,
    lastOptimization,
    onChange: setView,
    openChart,
    openTestForward,
    onBacktestResult,
    onOptimizationResult,
  }
}
