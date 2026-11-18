import { useCallback, useEffect, useState } from 'react'
import type { MarketDataProvider, TimeRange } from '@/api/marketDataProvider'
import { DEFAULT_INDICATOR_SETTINGS, type IndicatorSettings } from '@/components/utils/chartData'
import { describeError } from '@/components/utils/errorText'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import type { CandleRepository } from '@/storage/candleRepository'

/** Mensaje de la última operación de datos (éxito o error). */
export type Status = { kind: 'success' | 'error'; text: string } | null

/** Rebanada de datos de mercado que comparten el sidebar y el área principal. */
export interface MarketDataSlice {
  instrument: Instrument
  timeframe: Timeframe
  /** Velas locales del instrumento/timeframe activos (no la serie completa). */
  candles: readonly Candle[]
  instruments: readonly Instrument[]
  /** Indicadores del gráfico: los ajusta el sidebar, los dibuja el chart. */
  settings: IndicatorSettings
  busy: boolean
  status: Status
  onInstrumentChange: (instrument: Instrument) => void
  onTimeframeChange: (timeframe: Timeframe) => void
  onSettingsChange: (settings: IndicatorSettings) => void
  onFetch: (range: TimeRange | undefined) => Promise<void>
  onImport: (candles: readonly Candle[]) => void
  /** Error de un panel (p. ej. el importador CSV) → mensaje en el sidebar. */
  onError: (message: string) => void
}

export interface UseMarketDataOptions {
  repository: CandleRepository
  provider: MarketDataProvider
}

export function useMarketData({ repository, provider }: UseMarketDataOptions): MarketDataSlice {
  const [instrument, setInstrument] = useState<Instrument>(() => Instrument.of('BTC', 'USDT'))
  const [timeframe, setTimeframe] = useState<Timeframe>(Timeframe.HOUR)
  const [candles, setCandles] = useState<readonly Candle[]>([])
  const [instruments, setInstruments] = useState<readonly Instrument[]>([])
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_INDICATOR_SETTINGS)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    setInstruments(repository.listInstruments())
    try {
      setCandles(repository.find(instrument, timeframe))
    } catch (error) {
      setStatus({ kind: 'error', text: describeError(error) })
      setCandles([])
    }
  }, [repository, instrument, timeframe])

  useEffect(() => {
    reload()
  }, [reload])

  const onFetch = async (range: TimeRange | undefined) => {
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

  const onImport = (imported: readonly Candle[]) => {
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

  const onError = (message: string) => setStatus({ kind: 'error', text: message })

  return {
    instrument,
    timeframe,
    candles,
    instruments,
    settings,
    busy,
    status,
    onInstrumentChange: setInstrument,
    onTimeframeChange: setTimeframe,
    onSettingsChange: setSettings,
    onFetch,
    onImport,
    onError,
  }
}
