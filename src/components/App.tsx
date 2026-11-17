import type { MarketDataProvider } from '@/api/marketDataProvider'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { StrategyRepository } from '@/storage/strategyRepository'
import { AppSidebar } from './app/AppSidebar'
import { MainArea } from './app/MainArea'
import { useActiveSessions } from './hooks/useActiveSessions'
import { useExperimentStore } from './hooks/useExperimentStore'
import { useMainView } from './hooks/useMainView'
import { useMarketData } from './hooks/useMarketData'
import { useStrategyCatalog } from './hooks/useStrategyCatalog'

export interface AppProps {
  repository: CandleRepository
  provider: MarketDataProvider
  /** Experimentos persistidos en localStorage (Fase 6, §9). */
  experiments: ExperimentRepository
  /** Estrategias persistidas (§1.7); la selección es única para todos los paneles (§1.9). */
  strategies: StrategyRepository
  /** Storage de la UI (sección abierta del sidebar); por defecto, localStorage. */
  uiStorage?: Storage | null
}

/**
 * Raíz de composición de la pantalla principal (Fase 1). Solo conoce los dos
 * contenedores de alto nivel — `AppSidebar` y `MainArea` — y las rebanadas de
 * estado que les entrega: la lógica vive en los hooks (`hooks/`) y los
 * detalles de presentación en cada contenedor (`app/`). La coordinación entre
 * regiones es la composición de callbacks: abrir el editor → pestaña Gráfico;
 * iniciar test-forward → corta el replay y abre su pestaña.
 *
 * El sidebar es un acordeón de 3 secciones (Datos, Experimentos, Estrategias)
 * y el área principal conmuta entre 6 pestañas por estado (plan UI, sin
 * router): Gráfico · Backtest · Replay · Test-Forward · Optimización ·
 * Historial.
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
