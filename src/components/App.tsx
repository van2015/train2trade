import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketDataProvider, TimeRange } from '@/api/marketDataProvider'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Experiment, ExperimentSnapshot } from '@/domain/backtest/experiment'
import type { TestForwardRun } from '@/domain/backtest/testForward'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { StrategyRepository, StrategySnapshot } from '@/storage/strategyRepository'
import { loadOpenSection, saveOpenSection } from '@/storage/sidebarState'
import { CandleChart } from './CandleChart'
import { BacktestPanel } from './BacktestPanel'
import { BacktestResults } from './BacktestResults'
import { ReplayPanel } from './ReplayPanel'
import { ExperimentHistoryPanel } from './ExperimentHistoryPanel'
import { TestForwardPanel } from './TestForwardPanel'
import { TestForwardResults } from './TestForwardResults'
import { OptimizationPanel } from './OptimizationPanel'
import { OptimizationResults, type OptimizationViewState } from './OptimizationResults'
import { CsvImportPanel } from './CsvImportPanel'
import { DataControls } from './DataControls'
import { IndicatorPanel } from './IndicatorPanel'
import { StrategySelect } from './StrategySelect'
import { StrategyPanel } from './StrategyPanel'
import { MainTabs, type MainViewId } from './MainTabs'
import { isSidebarSectionId, SidebarSection, type SidebarSectionId } from './SidebarSection'
import {
  DEFAULT_INDICATOR_SETTINGS,
  type ChartLine,
  type IndicatorSettings,
  buildLines,
} from './chartData'

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

type Status = { kind: 'success' | 'error'; text: string } | null

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** localStorage del navegador; inaccesible (sandbox/cuota) → null y la UI sigue en memoria. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Pantalla principal (Fase 1): descargar o importar velas y visualizarlas con
 * indicadores. La lógica vive fuera de React; este componente solo coordina.
 * El sidebar es un acordeón de 2 secciones (Datos, Experimentos-formularios) y
 * el área principal conmuta entre 6 pestañas por estado (plan UI, sin router):
 * Gráfico · Backtest · Replay · Test-Forward · Optimización · Historial.
 */
export function App({ repository, provider, experiments, strategies, uiStorage }: AppProps) {
  const storage = uiStorage === undefined ? browserStorage() : uiStorage
  const [instrument, setInstrument] = useState<Instrument>(() => Instrument.of('BTC', 'USDT'))
  const [timeframe, setTimeframe] = useState<Timeframe>(Timeframe.HOUR)
  const [candles, setCandles] = useState<readonly Candle[]>([])
  const [instruments, setInstruments] = useState<readonly Instrument[]>([])
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_INDICATOR_SETTINGS)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  // Cursor del replay activo (null = sin sesión): el gráfico solo ve lo consumido.
  const [replayCursor, setReplayCursor] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<readonly ExperimentSnapshot[]>(() =>
    experiments.list(),
  )
  // Estrategias persistidas + selección única (§1.9): si la seleccionada se
  // borra, se cae a la primera de la lista.
  const [strategiesList, setStrategiesList] = useState<readonly StrategySnapshot[]>(() =>
    strategies.list(),
  )
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const selectedStrategy =
    strategiesList.find((strategy) => strategy.id === selectedStrategyId) ?? strategiesList[0]
  // Sección abierta del acordeón (plan UI, T1); id desconocido en storage → default.
  const [openSection, setOpenSection] = useState<SidebarSectionId | null>(() => {
    const stored = loadOpenSection(storage)
    return isSidebarSectionId(stored) ? stored : 'datos'
  })
  // Vista activa del área principal (plan UI, T4 + Fase 3).
  const [mainView, setMainView] = useState<MainViewId>('chart')
  // Resultados de cada experimento para su pestaña (Fase 3): auto-conmutación al ejecutar.
  const [lastExperiment, setLastExperiment] = useState<Experiment | null>(null)
  const [lastTestForward, setLastTestForward] = useState<TestForwardRun | null>(null)
  const [lastOptimization, setLastOptimization] = useState<OptimizationViewState | null>(null)

  const handleToggleSection = (id: SidebarSectionId) => {
    const next = openSection === id ? null : id
    setOpenSection(next)
    saveOpenSection(storage, next)
  }

  /** Auto-conmutación: cada ejecución con éxito abre la pestaña de sus resultados. */
  const handleBacktestResult = (next: Experiment) => {
    setLastExperiment(next)
    setMainView('backtest')
  }

  const handleTestForwardResult = (next: TestForwardRun) => {
    setLastTestForward(next)
    setMainView('testforward')
  }

  const handleOptimizationResult = (next: OptimizationViewState) => {
    setLastOptimization(next)
    setMainView('optimization')
  }

  const reloadExperiments = useCallback(() => {
    setSnapshots(experiments.list())
  }, [experiments])

  /** Tras el CRUD de estrategias (§1.8): la lista y la selección se recalculan. */
  const reloadStrategies = useCallback(() => {
    setStrategiesList(strategies.list())
  }, [strategies])

  /** Auto-guardo (§9/§12C): id determinístico → re-ejecutar sobrescribe, sin duplicados. */
  const handleExperiment = (experiment: Experiment) => {
    experiments.save(experiment.toSnapshot())
    reloadExperiments()
  }

  const handleRemoveExperiments = (ids: readonly string[]) => {
    for (const id of ids) experiments.remove(id)
    reloadExperiments()
  }

  const handleClearExperiments = () => {
    experiments.clear()
    reloadExperiments()
  }

  const reload = useCallback(() => {
    setInstruments(repository.listInstruments())
    try {
      setCandles(repository.find(instrument, timeframe))
    } catch (error) {
      setStatus({ kind: 'error', text: describeError(error) })
      setCandles([])
    }
  }, [repository, instrument, timeframe])

  // Cambiar de instrumento/timeframe recarga las velas locales.
  useEffect(() => {
    reload()
  }, [reload])

  // Con replay activo, el gráfico (velas e indicadores) solo ve lo consumido:
  // ni la UI ni la estrategia miran al futuro (§7B, anti look-ahead).
  const visible = replayCursor === null ? candles : candles.slice(0, replayCursor)

  const lines: readonly ChartLine[] = useMemo(
    () => buildLines(visible, settings),
    [visible, settings],
  )

  const handleFetch = async (range: TimeRange | undefined) => {
    setBusy(true)
    setStatus(null)
    try {
      const fetched = await provider.getCandles(instrument, timeframe, range)
      repository.save(instrument, timeframe, fetched)
      reload()
      setStatus({
        kind: 'success',
        text: `${fetched.length} velas descargadas de ${instrument} (${timeframe})`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  const handleImport = (imported: readonly Candle[]) => {
    try {
      repository.save(instrument, timeframe, imported)
      reload()
      setStatus({
        kind: 'success',
        text: `${imported.length} velas importadas en ${instrument} (${timeframe})`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: describeError(error) })
    }
  }

  const range =
    candles.length === 0
      ? 'sin datos'
      : replayCursor === null
        ? `${candles.length} velas`
        : `${visible.length}/${candles.length} velas`

  const results: Partial<Record<MainViewId, boolean>> = {
    backtest: lastExperiment !== null,
    testforward: lastTestForward !== null,
    optimization: lastOptimization !== null,
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">train2trade</h1>
        <p className="app__subtitle">Laboratorio de estrategias · Fase 6</p>
      </header>

      <div className="app__body">
        <aside className="app__sidebar">
          <SidebarSection
            id="datos"
            title="Datos"
            open={openSection === 'datos'}
            onToggle={handleToggleSection}
          >
            <DataControls
              instruments={instruments}
              instrument={instrument}
              timeframe={timeframe}
              busy={busy}
              onInstrumentChange={setInstrument}
              onTimeframeChange={setTimeframe}
              onFetch={handleFetch}
            />

            <CsvImportPanel
              target={`${instrument} · ${timeframe}`}
              disabled={busy}
              onImport={handleImport}
              onError={(message) => setStatus({ kind: 'error', text: message })}
            />

            <IndicatorPanel settings={settings} onChange={setSettings} />
          </SidebarSection>

          <SidebarSection
            id="experimentos"
            title="Experimentos"
            open={openSection === 'experimentos'}
            onToggle={handleToggleSection}
          >
            <StrategySelect
              strategies={strategiesList}
              selectedId={selectedStrategy?.id ?? null}
              onChange={setSelectedStrategyId}
            />

            <BacktestPanel
              candles={candles}
              timeframe={timeframe}
              instrument={instrument}
              strategy={selectedStrategy ?? null}
              onExperiment={handleExperiment}
              onResult={handleBacktestResult}
            />

            <TestForwardPanel
              candles={candles}
              timeframe={timeframe}
              strategy={selectedStrategy ?? null}
              onExperiment={handleExperiment}
              onResult={handleTestForwardResult}
            />

            <OptimizationPanel
              candles={candles}
              timeframe={timeframe}
              strategy={selectedStrategy ?? null}
              onResult={handleOptimizationResult}
            />
          </SidebarSection>

          <SidebarSection
            id="estrategias"
            title="Estrategias"
            open={openSection === 'estrategias'}
            onToggle={handleToggleSection}
          >
            <StrategyPanel
              strategies={strategiesList}
              repository={strategies}
              candles={candles}
              onChange={reloadStrategies}
            />
          </SidebarSection>

          {status !== null && (
            <p className={`status status--${status.kind}`} role="status" data-testid="status">
              {status.text}
            </p>
          )}
        </aside>

        <main className="app__main">
          <div className="app__chart-header">
            <MainTabs active={mainView} onChange={setMainView} results={results} />
            <div className="app__chart-meta">
              <span className="app__chart-instrument" data-testid="chart-instrument">
                {instrument.toString()} · {timeframe.toString()}
              </span>
              <span className="app__chart-range">{range}</span>
            </div>
          </div>

          {mainView === 'chart' && (
            <div
              className="app__view"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-chart"
            >
              <CandleChart candles={visible} lines={lines} />
            </div>
          )}

          {mainView === 'backtest' && (
            <div
              className="app__view app__view--results"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-backtest"
            >
              <BacktestResults experiment={lastExperiment} />
            </div>
          )}

          {/*
            Replay: siempre montado (oculto fuera de su pestaña) para no perder
            la sesión; el gráfico solo se monta mientras la pestaña está activa
            (evita dos instancias de lightweight-charts).
          */}
          <div
            className="app__view app__view--replay"
            id={mainView === 'replay' ? 'main-view' : 'replay-view'}
            role="tabpanel"
            aria-labelledby="main-tab-replay"
            hidden={mainView !== 'replay'}
          >
            <ReplayPanel
              candles={candles}
              timeframe={timeframe}
              strategy={selectedStrategy ?? null}
              onProgress={setReplayCursor}
            />
            {mainView === 'replay' && <CandleChart candles={visible} lines={lines} />}
          </div>

          {mainView === 'testforward' && (
            <div
              className="app__view app__view--results"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-testforward"
            >
              <TestForwardResults run={lastTestForward} />
            </div>
          )}

          {mainView === 'optimization' && (
            <div
              className="app__view app__view--results"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-optimization"
            >
              <OptimizationResults view={lastOptimization} />
            </div>
          )}

          {/*
            Historial: siempre montado (oculto fuera de su pestaña) para
            conservar la selección de comparación entre visitas.
          */}
          <div
            className="app__view app__view--results"
            id={mainView === 'history' ? 'main-view' : 'history-view'}
            role="tabpanel"
            aria-labelledby="main-tab-history"
            hidden={mainView !== 'history'}
          >
            <ExperimentHistoryPanel
              snapshots={snapshots}
              onRemove={handleRemoveExperiments}
              onClear={handleClearExperiments}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
