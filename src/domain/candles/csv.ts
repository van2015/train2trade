import { Candle, CandleFields, InvalidCandlesError } from './candle'
import { normalizeCandles } from './normalize'

export type CsvDelimiter = ',' | ';' | '\t'

/** Formato del campo tiempo en el CSV. */
export type CsvTimestampFormat = 'unixMs' | 'unixSeconds' | 'iso8601'

export interface CsvColumnRef {
  /** Nombre de la cabecera o índice numérico de columna (0-based). */
  column: string | number
}

export interface CsvCandlesImporterOptions {
  /** Delimitador de columnas. Si se omite, se detecta automáticamente (`,` `;` o tabulador). */
  delimiter?: CsvDelimiter
  /** true si la primera fila es cabecera (por defecto). */
  hasHeader?: boolean
  /** Formato del campo tiempo (por defecto `unixMs`). */
  timestampFormat?: CsvTimestampFormat
  /** Mapeo campo OHLCV → columna (nombre de cabecera o índice 0-based). Orden canónico si se omite. */
  columns?: Partial<Record<keyof CandleFields, CsvColumnRef>>
  /** Qué hacer con una fila inválida: omitirla (por defecto) o lanzar `InvalidCsvError`. */
  onInvalidRow?: 'skip' | 'throw'
}

const FIELD_KEYS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const

/** Índices de columna (0-based) de cada campo OHLCV dentro de una fila. */
type RowLayout = Record<keyof CandleFields, number>

/** Orden canónico por defecto: time, open, high, low, close, volume. */
const CANONICAL_LAYOUT: RowLayout = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 }

type RowContext = { line?: number; raw?: unknown }

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'un array'
  if (typeof value === 'object') return 'un objeto'
  return String(value)
}

export class InvalidCsvError extends Error {
  constructor(reason: string, context?: RowContext) {
    const location = context?.line !== undefined ? ` (línea ${context.line})` : ''
    const received = context && 'raw' in context ? ` (recibido: ${formatValue(context.raw)})` : ''
    super(`CSV inválido: ${reason}${location}${received}`)
    this.name = 'InvalidCsvError'
  }
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/**
 * Resuelve los índices de columna de cada campo: `columns` tiene prioridad
 * (nombre buscado en la cabecera o índice numérico) y, si se omite, se usa el
 * orden canónico. Lanza `InvalidCsvError` si un nombre no aparece en la cabecera.
 */
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

/**
 * Parsea una línea a una vela: extrae cada campo según `layout`, convierte el
 * tiempo según `timestampFormat` y valida invariantes con `Candle.from`.
 * Lanza `InvalidCsvError` (envolviendo `InvalidCandlesError`) con el contexto de la fila.
 */
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
 * Importador de velas desde texto CSV. Dominio puro: no hace I/O (la lectura
 * del fichero vive en la UI).
 *
 * - Parseo e invariantes de cada fila delegados en `Candle.from`.
 * - El documento completo deduplica y ordena (mismo criterio que `normalizeCandles`).
 * - Errores: `InvalidCsvError` con `this.name` y número de línea cuando aplique.
 * - `parseRow` siempre lanza ante una fila inválida (ignora `onInvalidRow`).
 */
export class CsvCandlesImporter {
  private readonly options: CsvCandlesImporterOptions

  constructor(options: CsvCandlesImporterOptions = {}) {
    this.options = options
  }

  /** Parsea el documento completo: cabecera, filas, deduplicado y orden ascendente por tiempo. */
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

  /**
   * Parsea una sola línea (sin salto de línea) a una vela válida.
   * Lanza `InvalidCsvError` ante cualquier fila inválida; si se usan nombres
   * de columna en `columns`, deben resolverse por índice numérico.
   */
  parseRow(row: string): Candle {
    const delimiter = this.options.delimiter ?? CsvCandlesImporter.detectDelimiter(row)
    const layout = resolveLayout(null, this.options.columns)
    const context: RowContext = { raw: row }
    return parseCandleRow(row, delimiter, layout, this.options.timestampFormat ?? 'unixMs', context)
  }

  /** Detecta el delimitador de un documento (`,` `;` o tabulador) contando la primera línea no vacía. */
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
