import { useState } from 'react'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import type { TimeRange } from '@/api/marketDataProvider'

const SUGGESTED_INSTRUMENTS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT']

/** Fechas `YYYY-MM-DD` → `TimeRange` UTC de día completo (inclusivo); vacías → `undefined`. */
export function buildRange(fromDate: string, toDate: string): TimeRange | undefined {
  const from = fromDate === '' ? undefined : Date.parse(`${fromDate}T00:00:00Z`)
  const to = toDate === '' ? undefined : Date.parse(`${toDate}T23:59:59.999Z`)

  if (from !== undefined && Number.isNaN(from)) {
    throw new RangeError(`Fecha inicial inválida: "${fromDate}"`)
  }
  if (to !== undefined && Number.isNaN(to)) {
    throw new RangeError(`Fecha final inválida: "${toDate}"`)
  }
  if (from === undefined && to === undefined) return undefined
  if (from !== undefined && to !== undefined && from > to) {
    throw new RangeError('La fecha inicial no puede ser posterior a la final')
  }

  return { from, to }
}

export interface DataControlsProps {
  instruments: readonly Instrument[]
  instrument: Instrument
  timeframe: Timeframe
  busy: boolean
  onInstrumentChange: (instrument: Instrument) => void
  onTimeframeChange: (timeframe: Timeframe) => void
  onFetch: (range: TimeRange | undefined) => void
}

/**
 * Selector de instrumento/timeframe, rango de fechas y descarga. Validación
 * local: solo se notifica al padre cuando la entrada es válida.
 */
export function DataControls({
  instruments,
  instrument,
  timeframe,
  busy,
  onInstrumentChange,
  onTimeframeChange,
  onFetch,
}: DataControlsProps) {
  const [text, setText] = useState(instrument.toString())
  const [instrumentError, setInstrumentError] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)

  const commitInstrument = (raw: string): boolean => {
    if (!Instrument.isValid(raw)) return false
    onInstrumentChange(Instrument.from(raw))
    setInstrumentError(null)
    return true
  }

  const handleInstrumentChange = (raw: string) => {
    setText(raw)
    if (Instrument.isValid(raw)) commitInstrument(raw)
  }

  const handleInstrumentBlur = () => {
    if (commitInstrument(text)) return
    setInstrumentError('Formato inválido: usa BASE/QUOTE (ej. BTC/USDT)')
    setText(instrument.toString())
  }

  const handleFetch = () => {
    try {
      const range = buildRange(fromDate, toDate)
      setRangeError(null)
      onFetch(range)
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : String(error))
    }
  }

  const datalistId = 'data-controls__instruments'
  const suggestions = [...new Set([...SUGGESTED_INSTRUMENTS, ...instruments.map(String)])].sort()

  return (
    <section className="data-controls" aria-label="Datos de mercado">
      <h2 className="panel-title">Datos de mercado</h2>

      <div className="field">
        <label htmlFor="data-controls__instrument">Instrumento</label>
        <input
          id="data-controls__instrument"
          list={datalistId}
          value={text}
          autoComplete="off"
          aria-invalid={instrumentError !== null}
          onChange={(event) => handleInstrumentChange(event.target.value)}
          onBlur={handleInstrumentBlur}
        />
        <datalist id={datalistId}>
          {suggestions.map((symbol) => (
            <option key={symbol} value={symbol} />
          ))}
        </datalist>
        {instrumentError !== null && (
          <p className="field__error" role="alert">
            {instrumentError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="data-controls__timeframe">Timeframe</label>
        <select
          id="data-controls__timeframe"
          value={timeframe.code}
          onChange={(event) => onTimeframeChange(Timeframe.from(event.target.value))}
        >
          {Timeframe.ALL.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field field--group">
        <legend>Rango (opcional)</legend>
        <div className="field__row">
          <label htmlFor="data-controls__from">Desde</label>
          <input
            id="data-controls__from"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="field__row">
          <label htmlFor="data-controls__to">Hasta</label>
          <input
            id="data-controls__to"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
        {rangeError !== null && (
          <p className="field__error" role="alert">
            {rangeError}
          </p>
        )}
      </fieldset>

      <button type="button" className="button" disabled={busy} onClick={handleFetch}>
        {busy ? 'Descargando…' : 'Descargar velas'}
      </button>
    </section>
  )
}
