import { DomainError, formatValue } from '@/domain/errors'
import { Candle, CandleFields, InvalidCandlesError } from './candle'
import { normalizeCandles } from './normalize'

export type CsvDelimiter = ',' | ';' | '\t'

export type CsvTimestampFormat = 'unixMs' | 'unixSeconds' | 'iso8601'

export interface CsvColumnRef {
  /** Nombre de cabecera o índice de columna (0-based). */
  column: string | number
}

export interface CsvCandlesImporterOptions {
  /** Si se omite, se detecta automáticamente (`,` `;` o tabulador). */
  delimiter?: CsvDelimiter
  /** ¿Primera fila es cabecera? Por defecto `true`. */
  hasHeader?: boolean
  /** Por defecto `unixMs`. */
  timestampFormat?: CsvTimestampFormat
  /** Mapeo campo OHLCV → columna. Orden canónico si se omite. */
  columns?: Partial<Record<keyof CandleFields, CsvColumnRef>>
  /** Por defecto `skip` (omitir la fila). */
  onInvalidRow?: 'skip' | 'throw'
}

const FIELD_KEYS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const

/** Índices de columna (0-based) de cada campo OHLCV dentro de una fila. */
type RowLayout = Record<keyof CandleFields, number>

const CANONICAL_LAYOUT: RowLayout = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 }

type RowContext = { line?: number; raw?: unknown }

export class InvalidCsvError extends DomainError {
  constructor(reason: string, context?: RowContext) {
    const location = context?.line !== undefined ? ` (línea ${context.line})` : ''
    const received = context && 'raw' in context ? ` (recibido: ${formatValue(context.raw)})` : ''
    super('InvalidCsvError', `CSV inválido: ${reason}${location}${received}`)
  }
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** Índices de columna: `columns` tiene prioridad; si se omite, el orden canónico. */
function resolveLayout(
  header: string[] | null,
  columns?: Partial<Record<keyof CandleFields, CsvColumnRef>>,
): RowLayout {
  const layout: RowLayout = { ...CANONICAL_LAYOUT }

  for (const key of FIELD_KEYS) {
    const ref = columns?.[key]
    if (ref === undefined) continue

    if (typeof ref.column === 'number') {
      layout[key] = ref.column
      continue
    }

    const index = header?.indexOf(ref.column) ?? -1
    if (index === -1) {
      throw new InvalidCsvError(
        header
          ? `no se encontró la columna "${ref.column}" en la cabecera`
          : `la columna "${ref.column}" necesita una cabecera con nombres`,
      )
    }
    layout[key] = index
  }

  return layout
}

function parseTimestamp(raw: string, format: CsvTimestampFormat, context: RowContext): number {
  if (format === 'iso8601') {
    const ms = Date.parse(raw)
    if (!Number.isFinite(ms)) {
      throw new InvalidCsvError(`el tiempo "${raw}" no es una fecha ISO 8601 válida`, context)
    }
    return ms
  }

  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new InvalidCsvError(`el tiempo "${raw}" no es un número válido`, context)
  }
  return format === 'unixSeconds' ? value * 1000 : value
}

/** Línea → vela: extrae campos, convierte el tiempo y valida con `Candle.from`. */
function parseCandleRow(
  line: string,
  delimiter: CsvDelimiter,
  layout: RowLayout,
  timestampFormat: CsvTimestampFormat,
  context: RowContext,
): Candle {
  const cells = line.split(delimiter)

  const cellOf = (key: keyof CandleFields): string => {
    const cell = cells[layout[key]]
    if (cell === undefined || cell.trim() === '') {
      throw new InvalidCsvError(`falta el valor de "${key}"`, context)
    }
    return cell.trim()
  }

  const value = {
    time: parseTimestamp(cellOf('time'), timestampFormat, context),
    open: cellOf('open'),
    high: cellOf('high'),
    low: cellOf('low'),
    close: cellOf('close'),
    volume: cellOf('volume'),
  }

  try {
    return Candle.from(value)
  } catch (error) {
    if (error instanceof InvalidCandlesError) {
      throw new InvalidCsvError(error.message, context)
    }
    throw error
  }
}

/**
 * Importador de velas desde texto CSV. Dominio puro: no hace I/O (el fichero
 * lo lee la UI). El documento completo deduplica y ordena como `normalizeCandles`.
 */
export class CsvCandlesImporter {
  private readonly options: CsvCandlesImporterOptions

  constructor(options: CsvCandlesImporterOptions = {}) {
    this.options = options
  }

  /** Parsea el documento completo (deduplicado y ordenado por tiempo). */
  parse(text: string): Candle[] {
    const lines = text.split(/\r?\n/)
    const firstIndex = lines.findIndex((line) => !isBlank(line))
    if (firstIndex === -1) return []

    const delimiter = this.options.delimiter ?? CsvCandlesImporter.detectDelimiter(text)
    const timestampFormat = this.options.timestampFormat ?? 'unixMs'

    let layout: RowLayout
    let startIndex: number
    if (this.options.hasHeader ?? true) {
      layout = resolveLayout((lines[firstIndex] ?? '').split(delimiter), this.options.columns)
      startIndex = firstIndex + 1
    } else {
      layout = resolveLayout(null, this.options.columns)
      startIndex = firstIndex
    }

    const strict = (this.options.onInvalidRow ?? 'skip') === 'throw'
    const parsed: Candle[] = []
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]
      if (line === undefined || isBlank(line)) continue

      const context: RowContext = { line: index + 1, raw: line }
      try {
        parsed.push(parseCandleRow(line, delimiter, layout, timestampFormat, context))
      } catch (error) {
        if (strict || !(error instanceof InvalidCsvError)) throw error
      }
    }

    return normalizeCandles(parsed)
  }

  /** Una sola línea a una vela; siempre lanza ante fila inválida (ignora `onInvalidRow`). */
  parseRow(row: string): Candle {
    const delimiter = this.options.delimiter ?? CsvCandlesImporter.detectDelimiter(row)
    const layout = resolveLayout(null, this.options.columns)
    const context: RowContext = { raw: row }
    return parseCandleRow(row, delimiter, layout, this.options.timestampFormat ?? 'unixMs', context)
  }

  /** Detecta el delimitador (`,` `;` o tabulador) de la primera línea no vacía. */
  static detectDelimiter(text: string): CsvDelimiter {
    const line = text.split(/\r?\n/).find((candidate) => !isBlank(candidate)) ?? ''
    const candidates: readonly CsvDelimiter[] = [',', ';', '\t']

    let detected: CsvDelimiter = ','
    let maxCount = 0
    for (const delimiter of candidates) {
      const count = line.split(delimiter).length - 1
      if (count > maxCount) {
        detected = delimiter
        maxCount = count
      }
    }
    return detected
  }
}
