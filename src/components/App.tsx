import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketDataProvider, TimeRange } from '@/api/marketDataProvider'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Experiment, ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { CandleChart } from './CandleChart'
import { BacktestPanel } from './BacktestPanel'
import { ReplayPanel } from './ReplayPanel'
import { ExperimentHistoryPanel } from './ExperimentHistoryPanel'
import { TestForwardPanel } from './TestForwardPanel'
import { OptimizationPanel } from './OptimizationPanel'
import { CsvImportPanel } from './CsvImportPanel'
import { DataControls } from './DataControls'
import { IndicatorPanel } from './IndicatorPanel'
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
}

type Status = { kind: 'success' | 'error'; text: string } | null

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Pantalla principal (Fase 1): descargar o importar velas y visualizarlas con
 * indicadores. La lógica vive fuera de React; este componente solo coordina.
 */
export function App({ repository, provider, experiments }: AppProps) {
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

          <BacktestPanel
            candles={candles}
            timeframe={timeframe}
            instrument={instrument}
            onExperiment={handleExperiment}
          />

          <ReplayPanel candles={candles} timeframe={timeframe} onProgress={setReplayCursor} />

          <ExperimentHistoryPanel
            snapshots={snapshots}
            onRemove={handleRemoveExperiments}
            onClear={handleClearExperiments}
          />

          <TestForwardPanel
            candles={candles}
            timeframe={timeframe}
            onExperiment={handleExperiment}
          />

          <OptimizationPanel candles={candles} timeframe={timeframe} />

          {status !== null && (
            <p className={`status status--${status.kind}`} role="status" data-testid="status">
              {status.text}
            </p>
          )}
        </aside>

        <main className="app__main">
          <div className="app__chart-header">
            <span className="app__chart-instrument" data-testid="chart-instrument">
              {instrument.toString()} · {timeframe.toString()}
            </span>
            <span className="app__chart-range">{range}</span>
          </div>
          <CandleChart candles={visible} lines={lines} />
        </main>
      </div>
    </div>
  )
}
