/** Vistas del área principal (plan UI, T4/Fase 3): conmutador por estado, sin router. */
export type MainViewId =
  'chart' | 'backtest' | 'replay' | 'testforward' | 'optimization' | 'history'

export interface MainTabsProps {
  active: MainViewId
  onChange: (view: MainViewId) => void
  /** Vistas con resultados: muestran un punto indicador en su pestaña. */
  results: Partial<Record<MainViewId, boolean>>
}

const TABS: readonly { id: MainViewId; label: string }[] = [
  { id: 'chart', label: 'Gráfico' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'replay', label: 'Replay' },
  { id: 'testforward', label: 'Test-Forward' },
  { id: 'optimization', label: 'Optimización' },
  { id: 'history', label: 'Historial' },
]

/** Barra de pestañas del área principal (plan UI, T4 + Fase 3). */
export function MainTabs({ active, onChange, results }: MainTabsProps) {
  return (
    <div className="main-tabs" role="tablist" aria-label="Vistas del área principal">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`main-tab-${tab.id}`}
          className="main-tabs__tab"
          aria-selected={active === tab.id}
          aria-controls="main-view"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {results[tab.id] === true && (
            <span
              className="main-tabs__dot"
              data-testid={`main-tabs-dot-${tab.id}`}
              aria-hidden="true"
            />
          )}
        </button>
      ))}
    </div>
  )
}
