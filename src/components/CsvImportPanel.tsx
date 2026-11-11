import { useRef, useState } from 'react'
import { CsvCandlesImporter, type CsvTimestampFormat } from '@/domain/candles/csv'
import type { Candle } from '@/domain/candles/candle'

const TIMESTAMP_FORMATS: readonly { value: CsvTimestampFormat; label: string }[] = [
  { value: 'unixMs', label: 'Unix (ms)' },
  { value: 'unixSeconds', label: 'Unix (s)' },
  { value: 'iso8601', label: 'ISO 8601' },
]

/** Lee un fichero como texto. Usa `FileReader` (disponible también en jsdom). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el fichero'))
    reader.readAsText(file)
  })
}

export interface CsvImportPanelProps {
  /** Destino de la importación, p. ej. `BTC/USDT · 1h` (solo informativo). */
  target: string
  disabled?: boolean
  /** Se llama con las velas ya parseadas y normalizadas. */
  onImport: (candles: readonly Candle[]) => void
  onError: (message: string) => void
}

/**
 * Importación de velas desde CSV: lee, parsea con `CsvCandlesImporter` (dominio
 * puro) y entrega velas validadas. El guardado lo decide el padre.
 */
export function CsvImportPanel({
  target,
  disabled = false,
  onImport,
  onError,
}: CsvImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [timestampFormat, setTimestampFormat] = useState<CsvTimestampFormat>('unixMs')
  const [hasHeader, setHasHeader] = useState(true)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleImport = async () => {
    const input = inputRef.current
    if (input === null || busy) return

    const file = input.files?.[0]
    if (file === undefined) return

    setBusy(true)
    try {
      const text = await readFileText(file)
      const candles = new CsvCandlesImporter({ timestampFormat, hasHeader }).parse(text)
      if (candles.length === 0) {
        onError('El CSV no contiene velas válidas')
        return
      }
      onImport(candles)
      setFileName(null)
      input.value = ''
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="csv-panel" aria-label="Importar CSV">
      <h2 className="panel-title">Importar CSV</h2>
      <p className="csv-panel__target">
        Destino: <b data-testid="csv-target">{target}</b>
      </p>

      <div className="field">
        <label htmlFor="csv-panel__file">Fichero</label>
        <input
          id="csv-panel__file"
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={disabled}
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        />
        {fileName !== null && <p className="csv-panel__file">{fileName}</p>}
      </div>

      <div className="field">
        <label htmlFor="csv-panel__timestamp">Formato de tiempo</label>
        <select
          id="csv-panel__timestamp"
          value={timestampFormat}
          disabled={disabled}
          onChange={(event) => setTimestampFormat(event.target.value as CsvTimestampFormat)}
        >
          {TIMESTAMP_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field field--check">
        <label htmlFor="csv-panel__header">
          <input
            id="csv-panel__header"
            type="checkbox"
            checked={hasHeader}
            disabled={disabled}
            onChange={(event) => setHasHeader(event.target.checked)}
          />
          La primera fila es cabecera
        </label>
      </div>

      <p className="csv-panel__hint">Columnas esperadas: time, open, high, low, close, volume</p>

      <button
        type="button"
        className="button"
        disabled={disabled || busy || fileName === null}
        onClick={handleImport}
      >
        {busy ? 'Importando…' : 'Importar'}
      </button>
    </section>
  )
}
