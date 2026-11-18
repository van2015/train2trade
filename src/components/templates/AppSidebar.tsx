import { useState } from 'react'
import { BacktestPanel } from '@/components/organisms/BacktestPanel'
import { CsvImportPanel } from '@/components/molecules/CsvImportPanel'
import { DataControls } from '@/components/molecules/DataControls'
import { IndicatorPanel } from '@/components/molecules/IndicatorPanel'
import { OptimizationPanel } from '@/components/organisms/OptimizationPanel'
import {
  isSidebarSectionId,
  SidebarSection,
  type SidebarSectionId,
} from '@/components/atoms/SidebarSection'
import { StrategyPanel } from '@/components/organisms/StrategyPanel'
import { StrategySelect } from '@/components/molecules/StrategySelect'
import { TestForwardPanel } from '@/components/organisms/TestForwardPanel'
import type { ActiveSessionsSlice } from '@/components/hooks/useActiveSessions'
import type { ExperimentStoreSlice } from '@/components/hooks/useExperimentStore'
import type { MainViewSlice } from '@/components/hooks/useMainView'
import type { MarketDataSlice } from '@/components/hooks/useMarketData'
import type { StrategyCatalogSlice } from '@/components/hooks/useStrategyCatalog'
import { loadOpenSection, saveOpenSection } from '@/storage/sidebarState'
import { Button } from '@/components/atoms/Button'

export interface AppSidebarProps {
  uiStorage?: Storage | null
  data: MarketDataSlice
  catalog: StrategyCatalogSlice
  store: ExperimentStoreSlice
  nav: MainViewSlice
  sessions: ActiveSessionsSlice
}

/** localStorage del navegador; inaccesible (sandbox/cuota) → null y la UI sigue en memoria. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

interface SectionShellProps {
  open: boolean
  onToggle: (id: SidebarSectionId) => void
}

function DataSection({ data, open, onToggle }: SectionShellProps & { data: MarketDataSlice }) {
  return (
    <SidebarSection id="datos" title="Datos" open={open} onToggle={onToggle}>
      <DataControls
        instruments={data.instruments}
        instrument={data.instrument}
        timeframe={data.timeframe}
        busy={data.busy}
        onInstrumentChange={data.onInstrumentChange}
        onTimeframeChange={data.onTimeframeChange}
        onFetch={data.onFetch}
      />

      <CsvImportPanel
        target={`${data.instrument} · ${data.timeframe}`}
        disabled={data.busy}
        onImport={data.onImport}
        onError={data.onError}
      />

      <IndicatorPanel settings={data.settings} onChange={data.onSettingsChange} />
    </SidebarSection>
  )
}

function ExperimentsSection({
  data,
  catalog,
  store,
  nav,
  sessions,
  open,
  onToggle,
}: SectionShellProps & {
  data: MarketDataSlice
  catalog: StrategyCatalogSlice
  store: ExperimentStoreSlice
  nav: MainViewSlice
  sessions: ActiveSessionsSlice
}) {
  return (
    <SidebarSection id="experimentos" title="Experimentos" open={open} onToggle={onToggle}>
      <StrategySelect
        strategies={catalog.strategies}
        selectedId={catalog.selectedId}
        onChange={catalog.onSelectedChange}
      />

      <BacktestPanel
        candles={data.candles}
        timeframe={data.timeframe}
        instrument={data.instrument}
        strategy={catalog.selected}
        onExperiment={store.onExperiment}
        onResult={nav.onBacktestResult}
      />

      <TestForwardPanel
        candles={data.candles}
        timeframe={data.timeframe}
        strategy={catalog.selected}
        onStart={sessions.onTfStart}
      />

      <OptimizationPanel
        candles={data.candles}
        timeframe={data.timeframe}
        strategy={catalog.selected}
        onResult={nav.onOptimizationResult}
      />
    </SidebarSection>
  )
}

function StrategiesSection({
  data,
  catalog,
  open,
  onToggle,
}: SectionShellProps & { data: MarketDataSlice; catalog: StrategyCatalogSlice }) {
  return (
    <SidebarSection id="estrategias" title="Estrategias" open={open} onToggle={onToggle}>
      <StrategyPanel
        strategies={catalog.strategies}
        repository={catalog.repository}
        candles={data.candles}
        onChange={catalog.reload}
        onEditingChange={catalog.onEditingChange}
      />
    </SidebarSection>
  )
}

/** La sección abierta se persiste aquí: es un detalle de este contenedor, no de App. */
export function AppSidebar({ uiStorage, data, catalog, store, nav, sessions }: AppSidebarProps) {
  const storage = uiStorage === undefined ? browserStorage() : uiStorage

  const [openSection, setOpenSection] = useState<SidebarSectionId | null>(() => {
    const stored = loadOpenSection(storage)
    return isSidebarSectionId(stored) ? stored : 'datos'
  })

  const handleToggleSection = (id: SidebarSectionId) => {
    const next = openSection === id ? null : id
    setOpenSection(next)
    saveOpenSection(storage, next)
  }

  return (
    <aside className="app__sidebar">
      {catalog.corrupted.length > 0 && (
        <div className="storage-warning" role="alert" data-testid="storage-warning">
          <span>
            {catalog.corrupted.length === 1
              ? '1 estrategia ignorada'
              : `${catalog.corrupted.length} estrategias ignoradas`}{' '}
            (datos corruptos en el almacenamiento)
          </span>
          <Button onClick={catalog.onRepair}>Reparar</Button>
        </div>
      )}

      <DataSection data={data} open={openSection === 'datos'} onToggle={handleToggleSection} />

      <ExperimentsSection
        data={data}
        catalog={catalog}
        store={store}
        nav={nav}
        sessions={sessions}
        open={openSection === 'experimentos'}
        onToggle={handleToggleSection}
      />

      <StrategiesSection
        data={data}
        catalog={catalog}
        open={openSection === 'estrategias'}
        onToggle={handleToggleSection}
      />

      {data.status !== null && (
        <p className={`status status--${data.status.kind}`} role="status" data-testid="status">
          {data.status.text}
        </p>
      )}
    </aside>
  )
}
