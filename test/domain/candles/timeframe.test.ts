import { describe, expect, it } from 'vitest'
import { InvalidTimeframeError, Timeframe, type TimeframeCode } from '@/domain/candles/timeframe'

describe('Timeframe', () => {
  it('expone los timeframes del backlog como instancias', () => {
    const codes: TimeframeCode[] = ['1m', '5m', '15m', '1h', '4h', '1d']
    expect(Timeframe.ALL.map((tf) => tf.code)).toEqual(codes)
    for (const code of codes) {
      expect(Timeframe.is(Timeframe.from(code))).toBe(true)
    }
  })

  it('from parsea códigos y lanza ante desconocidos o tipos inválidos', () => {
    expect(Timeframe.from('15m')).toBe(Timeframe.FIFTEEN_MINUTES)

    expect(() => Timeframe.from('7m')).toThrow(InvalidTimeframeError)
    expect(() => Timeframe.from('2h')).toThrow(InvalidTimeframeError)
    expect(() => Timeframe.from('')).toThrow(InvalidTimeframeError)
    expect(() => Timeframe.from('1M')).toThrow(InvalidTimeframeError) // mayúscula distinguida
    expect(() => Timeframe.from(42)).toThrow(InvalidTimeframeError)
    expect(() => Timeframe.from(undefined)).toThrow(InvalidTimeframeError)
    expect(() => Timeframe.from(null)).toThrow(InvalidTimeframeError)
  })

  it('el error de parseo es informativo (nombre y códigos válidos)', () => {
    expect(() => Timeframe.from('2h')).toThrow(/timeframe/i)
    expect(() => Timeframe.from('2h')).toThrow(/1m, 5m, 15m, 1h, 4h, 1d/)
    try {
      Timeframe.from('2h')
      expect.unreachable('debió lanzar')
    } catch (error) {
      expect((error as InvalidTimeframeError).name).toBe('InvalidTimeframeError')
    }
  })

  it('from es idempotente e internea instancias (semántica de valor)', () => {
    expect(Timeframe.from('1h')).toBe(Timeframe.HOUR)
    expect(Timeframe.from(Timeframe.HOUR)).toBe(Timeframe.HOUR)
    expect(Timeframe.from('1h')).toBe(Timeframe.from('1h'))
    expect(Timeframe.from('1h').equals(Timeframe.HOUR)).toBe(true)
    expect(Timeframe.HOUR.equals(Timeframe.DAY)).toBe(false)
  })

  it('is e isCode distinguen instancia de código crudo sin lanzar', () => {
    expect(Timeframe.is(Timeframe.MINUTE)).toBe(true)
    expect(Timeframe.is('1m')).toBe(false)
    expect(Timeframe.is(42)).toBe(false)

    expect(Timeframe.isCode('15m')).toBe(true)
    expect(Timeframe.isCode('2h')).toBe(false)
    expect(Timeframe.isCode('')).toBe(false)
    expect(Timeframe.isCode(42)).toBe(false)
    expect(Timeframe.isCode(Timeframe.HOUR)).toBe(false)
  })

  it('ms expone la duración en milisegundos de cada timeframe', () => {
    expect(Timeframe.MINUTE.ms).toBe(60_000)
    expect(Timeframe.FIVE_MINUTES.ms).toBe(300_000)
    expect(Timeframe.FIFTEEN_MINUTES.ms).toBe(900_000)
    expect(Timeframe.HOUR.ms).toBe(3_600_000)
    expect(Timeframe.FOUR_HOURS.ms).toBe(14_400_000)
    expect(Timeframe.DAY.ms).toBe(86_400_000)
  })

  it('bucketOf devuelve el inicio del bucket que contiene un timestamp', () => {
    expect(Timeframe.FIVE_MINUTES.bucketOf(0)).toBe(0)
    expect(Timeframe.FIVE_MINUTES.bucketOf(299_999)).toBe(0) // dentro del bucket
    expect(Timeframe.FIVE_MINUTES.bucketOf(300_000)).toBe(300_000) // borde exacto
    expect(Timeframe.FIVE_MINUTES.bucketOf(300_001)).toBe(300_000)
    expect(Timeframe.HOUR.bucketOf(1_700_000_000_000)).toBe(1_699_999_200_000) // trunca a la hora
    expect(Timeframe.MINUTE.bucketOf(90_000)).toBe(60_000)
  })

  it('serializa a código y lo recupera (round-trip por JSON)', () => {
    expect(String(Timeframe.HOUR)).toBe('1h')
    expect(JSON.stringify({ tf: Timeframe.FOUR_HOURS })).toBe('{"tf":"4h"}')
    expect(Timeframe.from(JSON.parse('"1d"'))).toBe(Timeframe.DAY)
  })
})
