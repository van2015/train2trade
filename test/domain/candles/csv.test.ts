import { describe, expect, it } from 'vitest'
import { Candle, CandleFields } from '@/domain/candles/candle'
import { CsvCandlesImporter, InvalidCsvError } from '@/domain/candles/csv'

const HEADER = 'time,open,high,low,close,volume'

function candle(overrides: Partial<CandleFields> = {}): Candle {
  return Candle.from({
    time: 1000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
    ...overrides,
  })
}

describe('CsvCandlesImporter', () => {
  describe('detectDelimiter', () => {
    it('detecta coma', () => {
      expect(CsvCandlesImporter.detectDelimiter(`${HEADER}\n1,2,3,4,5,6`)).toBe(',')
    })

    it('detecta punto y coma', () => {
      expect(CsvCandlesImporter.detectDelimiter('time;open\n1000;10')).toBe(';')
    })

    it('detecta tabulador', () => {
      expect(CsvCandlesImporter.detectDelimiter('time\topen\n1000\t10')).toBe('\t')
    })
  })

  describe('parse', () => {
    it('parsea un CSV con cabecera en orden canónico', () => {
      const text = `${HEADER}\n1000,10,12,9,11,100`
      const importer = new CsvCandlesImporter()

      expect(importer.parse(text)).toEqual([candle()])
    })

    it('devuelve un array vacío para texto vacío o en blanco', () => {
      const importer = new CsvCandlesImporter()

      expect(importer.parse('')).toEqual([])
      expect(importer.parse('   \n  ')).toEqual([])
    })

    it('devuelve un array vacío si solo hay cabecera', () => {
      const importer = new CsvCandlesImporter()

      expect(importer.parse(HEADER)).toEqual([])
    })

    it('deduplica (gana el último) y ordena ascendente por tiempo', () => {
      const text = [
        HEADER,
        '2000,10,12,9,11,100',
        '1000,10,12,9,11,100',
        '2000,20,22,19,21,200',
      ].join('\n')
      const importer = new CsvCandlesImporter()

      expect(importer.parse(text)).toEqual([
        candle({ time: 1000 }),
        candle({ time: 2000, open: 20, high: 22, low: 19, close: 21, volume: 200 }),
      ])
    })

    it('detecta el punto y coma automáticamente', () => {
      const text = 'time;open;high;low;close;volume\n1000;10;12;9;11;100'
      const importer = new CsvCandlesImporter()

      expect(importer.parse(text)).toEqual([candle()])
    })

    it('con hasHeader: false usa el orden canónico sin primera fila de cabecera', () => {
      const importer = new CsvCandlesImporter({ hasHeader: false })

      expect(importer.parse('1000,10,12,9,11,100')).toEqual([candle()])
    })

    it('con timestampFormat unixSeconds convierte a milisegundos', () => {
      const importer = new CsvCandlesImporter({ timestampFormat: 'unixSeconds' })

      expect(importer.parse(`${HEADER}\n1,10,12,9,11,100`)).toEqual([candle({ time: 1000 })])
    })

    it('con timestampFormat iso8601 parsea la fecha a milisegundos UTC', () => {
      const importer = new CsvCandlesImporter({ timestampFormat: 'iso8601' })
      const text = `${HEADER}\n2024-01-01T00:00:00.000Z,10,12,9,11,100`

      expect(importer.parse(text)).toEqual([candle({ time: Date.UTC(2024, 0, 1) })])
    })

    it('mapea cabeceras con nombres personalizados mediante columns', () => {
      const text = 'Date,Open,High,Low,Close,Vol\n1000,10,12,9,11,100'
      const importer = new CsvCandlesImporter({
        columns: {
          time: { column: 'Date' },
          open: { column: 'Open' },
          high: { column: 'High' },
          low: { column: 'Low' },
          close: { column: 'Close' },
          volume: { column: 'Vol' },
        },
      })

      expect(importer.parse(text)).toEqual([candle()])
    })

    it('omite las filas inválidas con onInvalidRow skip (por defecto)', () => {
      const text = [HEADER, '1000,10,12,9,11,100', 'not_a_time,10,12,9,11,100'].join('\n')
      const importer = new CsvCandlesImporter()

      expect(importer.parse(text)).toEqual([candle()])
    })

    it('omite las velas con high < low', () => {
      const text = [HEADER, '1000,10,12,9,11,100', '2000,10,9,12,11,100'].join('\n')
      const importer = new CsvCandlesImporter()

      expect(importer.parse(text)).toEqual([candle()])
    })

    it('con onInvalidRow throw lanza InvalidCsvError en la primera fila inválida', () => {
      const text = [HEADER, '1000,10,12,9,11,100', '2000,not_a_price,12,9,11,100'].join('\n')
      const importer = new CsvCandlesImporter({ onInvalidRow: 'throw' })

      expect(() => importer.parse(text)).toThrow(InvalidCsvError)
      expect(() => importer.parse(text)).toThrow(/línea 3/)
    })

    it('el error tiene name InvalidCsvError', () => {
      const importer = new CsvCandlesImporter({ onInvalidRow: 'throw' })
      const caught = (() => {
        try {
          importer.parse(`${HEADER}\nbad,row`)
        } catch (error) {
          return error
        }
        return null
      })()

      expect(caught).toBeInstanceOf(InvalidCsvError)
      expect((caught as Error).name).toBe('InvalidCsvError')
    })
  })

  describe('parseRow', () => {
    it('parsea una fila suelta en el orden canónico', () => {
      const importer = new CsvCandlesImporter()

      expect(importer.parseRow('1000,10,12,9,11,100')).toEqual(candle())
    })

    it('lanza InvalidCsvError con una fila corrupta', () => {
      const importer = new CsvCandlesImporter()

      expect(() => importer.parseRow('1000,10,12')).toThrow(InvalidCsvError)
      expect(() => importer.parseRow('')).toThrow(InvalidCsvError)
    })
  })
})
