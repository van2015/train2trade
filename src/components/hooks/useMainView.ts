import { useState } from 'react'
import type { MainViewId } from '@/components/MainTabs'
import type { OptimizationViewState } from '@/components/OptimizationResults'
import type { Experiment } from '@/domain/backtest/experiment'

/** Pestaña activa del área principal + resultados de cada experimento (Fase 3). */
export interface MainViewSlice {
  view: MainViewId
  /** Último backtest con éxito; null → su pestaña muestra el estado vacío. */
  lastExperiment: Experiment | null
  /** Última optimización con éxito; null → su pestaña muestra el estado vacío. */
  lastOptimization: OptimizationViewState | null
  onChange: (view: MainViewId) => void
  /** Abre la pestaña Gráfico (al abrir el editor de estrategias, §1.8). */
  openChart: () => void
  /** Abre la pestaña Test-Forward (al iniciar una sesión, §2.3). */
  openTestForward: () => void
  /** Auto-conmutación: cada backtest con éxito abre su pestaña (plan UI, T3). */
  onBacktestResult: (experiment: Experiment) => void
  /** Auto-conmutación: cada optimización con éxito abre su pestaña (Fase 3). */
  onOptimizationResult: (view: OptimizationViewState) => void
}

/**
 * Navegación del área principal por estado (plan UI, sin router) con las
 * reglas de auto-conmutación: ejecutar un experimento abre su pestaña y
 * abrir el editor vuelve al Gráfico.
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
