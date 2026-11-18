import type { MarketDataProvider } from '@/api/marketDataProvider'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { StrategyRepository } from '@/storage/strategyRepository'
import { AppSidebar } from '@/components/templates/AppSidebar'
import { MainArea } from '@/components/templates/MainArea'
import { useActiveSessions } from '@/components/hooks/useActiveSessions'
import { useExperimentStore } from '@/components/hooks/useExperimentStore'
import { useMainView } from '@/components/hooks/useMainView'
import { useMarketData } from '@/components/hooks/useMarketData'
import { useStrategyCatalog } from '@/components/hooks/useStrategyCatalog'

export interface AppProps {
  repository: CandleRepository
  provider: MarketDataProvider
  experiments: ExperimentRepository
  strategies: StrategyRepository
  /** Por defecto, localStorage; `null` → la UI vive solo en memoria. */
  uiStorage?: Storage | null
}

/**
 * Raíz de composición: solo conoce los dos contenedores (`templates/`) y las
 * rebanadas de estado de los hooks. La coordinación entre regiones es
 * composición de callbacks: abrir el editor → pestaña Gráfico; iniciar
 * test-forward → corta el replay y abre su pestaña.
 */
export function App({ repository, provider, experiments, strategies, uiStorage }: AppProps) {
  const nav = useMainView()
  const data = useMarketData({ repository, provider })
  const catalog = useStrategyCatalog({ strategies, onEditingOpened: nav.openChart })
  const store = useExperimentStore({ experiments })
  const sessions = useActiveSessions({ onSessionStarted: nav.openTestForward })

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">train2trade</h1>
        <p className="app__subtitle">Laboratorio de estrategias · Fase 6</p>
      </header>

      <div className="app__body">
        <AppSidebar
          uiStorage={uiStorage}
          data={data}
          catalog={catalog}
          store={store}
          nav={nav}
          sessions={sessions}
        />
        <MainArea data={data} catalog={catalog} store={store} nav={nav} sessions={sessions} />
      </div>
    </div>
  )
}
