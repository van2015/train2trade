import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketDataProvider, TimeRange } from '@/api/marketDataProvider'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Experiment, ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { loadOpenSection, saveOpenSection } from '@/storage/sidebarState'
import { CandleChart } from './CandleChart'
import { BacktestPanel } from './BacktestPanel'
import { BacktestResults } from './BacktestResults'
import { ReplayPanel } from './ReplayPanel'
import { ExperimentHistoryPanel } from './ExperimentHistoryPanel'
import { TestForwardPanel } from './TestForwardPanel'
import { OptimizationPanel } from './OptimizationPanel'
import { CsvImportPanel } from './CsvImportPanel'
import { DataControls } from './DataControls'
import { IndicatorPanel } from './IndicatorPanel'
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
 * El sidebar es un acordeón de 3 secciones y el área principal conmuta entre
 * `Gráfico` y `Backtest` por estado (plan UI, sin router).
 */
export function App({ repository, provider, experiments, uiStorage }: AppProps) {
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
  // Sección abierta del acordeón (plan UI, T1); id desconocido en storage → default.
  const [openSection, setOpenSection] = useState<SidebarSectionId | null>(() => {
    const stored = loadOpenSection(storage)
    return isSidebarSectionId(stored) ? stored : 'datos'
  })
  // Vista activa del área principal (plan UI, T4).
  const [mainView, setMainView] = useState<MainViewId>('chart')
  // Último backtest ejecutado, mostrado en la pestaña Backtest (plan UI, T3).
  const [lastExperiment, setLastExperiment] = useState<Experiment | null>(null)

  const handleToggleSection = (id: SidebarSectionId) => {
    const next = openSection === id ? null : id
    setOpenSection(next)
    saveOpenSection(storage, next)
  }

  /** Auto-conmutación: un backtest con éxito pasa la vista a `Backtest`. */
  const handleBacktestResult = (next: Experiment) => {
    setLastExperiment(next)
    setMainView('backtest')
  }

  const reloadExperiments = useCallback(() => {
    setSnapshots(experiments.list())
  }, [experiments])

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
            <BacktestPanel
              candles={candles}
              timeframe={timeframe}
              instrument={instrument}
              onExperiment={handleExperiment}
              onResult={handleBacktestResult}
            />

            <ReplayPanel candles={candles} timeframe={timeframe} onProgress={setReplayCursor} />

            <TestForwardPanel
              candles={candles}
              timeframe={timeframe}
              onExperiment={handleExperiment}
            />

            <OptimizationPanel candles={candles} timeframe={timeframe} />
          </SidebarSection>

          <SidebarSection
            id="resultados"
            title="Resultados"
            open={openSection === 'resultados'}
            onToggle={handleToggleSection}
          >
            <ExperimentHistoryPanel
              snapshots={snapshots}
              onRemove={handleRemoveExperiments}
              onClear={handleClearExperiments}
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
            <MainTabs
              active={mainView}
              onChange={setMainView}
              hasResult={lastExperiment !== null}
            />
            <div className="app__chart-meta">
              <span className="app__chart-instrument" data-testid="chart-instrument">
                {instrument.toString()} · {timeframe.toString()}
              </span>
              <span className="app__chart-range">{range}</span>
            </div>
          </div>

          {mainView === 'chart' ? (
            <div
              className="app__view"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-chart"
            >
              <CandleChart candles={visible} lines={lines} />
            </div>
          ) : (
            <div
              className="app__view app__view--results"
              id="main-view"
              role="tabpanel"
              aria-labelledby="main-tab-backtest"
            >
              <BacktestResults experiment={lastExperiment} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
