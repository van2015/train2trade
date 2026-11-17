import { useMemo } from 'react'
import { BacktestResults } from '@/components/BacktestResults'
import { ExperimentHistoryPanel } from '@/components/ExperimentHistoryPanel'
import { MainTabs, type MainViewId } from '@/components/MainTabs'
import { OptimizationResults } from '@/components/OptimizationResults'
import { type ChartLine, buildLines } from '@/components/chartData'
import type { ActiveSessionsSlice } from '@/components/hooks/useActiveSessions'
import type { ExperimentStoreSlice } from '@/components/hooks/useExperimentStore'
import type { MainViewSlice } from '@/components/hooks/useMainView'
import type { MarketDataSlice } from '@/components/hooks/useMarketData'
import type { StrategyCatalogSlice } from '@/components/hooks/useStrategyCatalog'
import { ChartView } from './ChartView'
import { ReplayView } from './ReplayView'
import { TestForwardView } from './TestForwardView'

export interface MainAreaProps {
  /** Velas, instrumento/timeframe y indicadores (meta + gráfico + paneles). */
  data: MarketDataSlice
  /** Estrategia activa (replay) y draft del editor (preview). */
  catalog: StrategyCatalogSlice
  /** Historial de experimentos (pestaña Historial). */
  store: ExperimentStoreSlice
  /** Pestaña activa + últimos resultados (auto-conmutación). */
  nav: MainViewSlice
  /** Sesiones en curso: recortan las velas que ve el gráfico (§7B/§2.3). */
  sessions: ActiveSessionsSlice
}

/**
 * Área principal (plan UI, sin router): barra de pestañas + meta del gráfico +
 * las 6 vistas. Gráfico, Replay y Test-Forward están extraídos; el recorte de
 * sesión (`visible`) y las líneas de indicadores se derivan aquí.
 */
export function MainArea({ data, catalog, store, nav, sessions }: MainAreaProps) {
  const { instrument, timeframe, candles, settings } = data

  // Con una sesión activa, el gráfico (velas e indicadores) solo ve lo
  // consumido: ni la UI ni la estrategia miran al futuro (§7B/§2.3).
  const activeCursor = sessions.activeCursor
  const visible = activeCursor === null ? candles : candles.slice(0, activeCursor)

  const lines: readonly ChartLine[] = useMemo(
    () => buildLines(visible, settings),
    [visible, settings],
  )

  const range =
    candles.length === 0
      ? 'sin datos'
      : activeCursor === null
        ? `${candles.length} velas`
        : `${visible.length}/${candles.length} velas`

  const results: Partial<Record<MainViewId, boolean>> = {
    backtest: nav.lastExperiment !== null,
    testforward: sessions.hasTestForward,
    optimization: nav.lastOptimization !== null,
  }

  return (
    <main className="app__main">
      <div className="app__chart-header">
        <MainTabs active={nav.view} onChange={nav.onChange} results={results} />
        <div className="app__chart-meta">
          <span className="app__chart-instrument" data-testid="chart-instrument">
            {instrument.toString()} · {timeframe.toString()}
          </span>
          <span className="app__chart-range">{range}</span>
        </div>
      </div>

      <ChartView
        active={nav.view === 'chart'}
        candles={visible}
        lines={lines}
        editingSpec={catalog.editingSpec}
      />

      {nav.view === 'backtest' && (
        <div
          className="app__view app__view--results"
          id="main-view"
          role="tabpanel"
          aria-labelledby="main-tab-backtest"
        >
          <BacktestResults experiment={nav.lastExperiment} />
        </div>
      )}

      <ReplayView
        active={nav.view === 'replay'}
        candles={candles}
        visible={visible}
        lines={lines}
        timeframe={timeframe}
        strategy={catalog.selected}
        onProgress={sessions.onReplayProgress}
      />

      <TestForwardView
        active={nav.view === 'testforward'}
        session={sessions.tfSession}
        candles={candles}
        visible={visible}
        lines={lines}
        onProgress={sessions.onTfProgress}
      />

      {nav.view === 'optimization' && (
        <div
          className="app__view app__view--results"
          id="main-view"
          role="tabpanel"
          aria-labelledby="main-tab-optimization"
        >
          <OptimizationResults view={nav.lastOptimization} />
        </div>
      )}

      {/* Historial: siempre montado (oculto fuera de su pestaña) para
          conservar la selección de comparación entre visitas. */}
      <div
        className="app__view app__view--results"
        id={nav.view === 'history' ? 'main-view' : 'history-view'}
        role="tabpanel"
        aria-labelledby="main-tab-history"
        hidden={nav.view !== 'history'}
      >
        <ExperimentHistoryPanel
          snapshots={store.snapshots}
          onRemove={store.onRemove}
          onClear={store.onClear}
        />
      </div>
    </main>
  )
}
