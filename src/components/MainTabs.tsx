/** Vistas del área principal (plan UI, T4): conmutador por estado, sin router. */
export type MainViewId = 'chart' | 'backtest'

export interface MainTabsProps {
  active: MainViewId
  onChange: (view: MainViewId) => void
  /** true si hay resultados de backtest → indicador en la pestaña Backtest. */
  hasResult: boolean
}

const TABS: readonly { id: MainViewId; label: string }[] = [
  { id: 'chart', label: 'Gráfico' },
  { id: 'backtest', label: 'Backtest' },
]

/** Barra de pestañas `Gráfico | Backtest` del área principal (plan UI, T4). */
export function MainTabs({ active, onChange, hasResult }: MainTabsProps) {
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
          {tab.id === 'backtest' && hasResult && (
            <span className="main-tabs__dot" data-testid="main-tabs-dot" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  )
}
