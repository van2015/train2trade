import { describe, expect, it } from 'vitest'
import { Candle, InvalidCandlesError, type CandleFields } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'

const MIN = 60_000

function fields(overrides: Partial<CandleFields> = {}): CandleFields {
  return { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1, ...overrides }
}

describe('Candle.from', () => {
  it('construye una vela desde campos de la API (acepta strings)', () => {
    const candle = Candle.from({
      time: 1_700_000_000_000,
      open: '100.5',
      high: '110',
      low: '95.2',
      close: '108.75',
      volume: '12.4',
    })

    expect(candle).toBeInstanceOf(Candle)
    expect(candle.open).toBe(100.5)
    expect(candle.low).toBe(95.2)
    expect(candle.volume).toBe(12.4)
  })

  it('es idempotente: una instancia vuelve tal cual', () => {
    const candle = Candle.from(fields())
    expect(Candle.from(candle)).toBe(candle)
  })

  it('lanza InvalidCandlesError ante campos no finitos o ausentes', () => {
    expect(() => Candle.from(fields({ close: NaN }))).toThrow(InvalidCandlesError)
    expect(() => Candle.from(fields({ high: Infinity }))).toThrow(InvalidCandlesError)
    expect(() => Candle.from({ time: 1, open: 1, high: 1, low: 1, close: 1 })).toThrow(
      InvalidCandlesError, // sin volume
    )
  })

  it('lanza ante high < low', () => {
    expect(() => Candle.from(fields({ high: 5, low: 6 }))).toThrow(InvalidCandlesError)
  })

  it('lanza ante valores que no son un objeto de velas', () => {
    expect(() => Candle.from(null)).toThrow(InvalidCandlesError)
    expect(() => Candle.from(undefined)).toThrow(InvalidCandlesError)
    expect(() => Candle.from(42)).toThrow(InvalidCandlesError)
    expect(() => Candle.from('time=1')).toThrow(InvalidCandlesError)
  })

  it('el error explica el campo culpable', () => {
    expect(() => Candle.from(fields({ close: NaN }))).toThrow(/close/)
    expect(() => Candle.from({ time: 1, open: 1, high: 1, low: 1, close: 1 })).toThrow(/volume/)
  })
})

describe('comportamiento de la vela', () => {
  it('isBullish / isBearish según cierre frente a apertura', () => {
    const alcista = Candle.from(fields({ open: 10, close: 11 }))
    const bajista = Candle.from(fields({ open: 11, close: 10 }))

    expect(alcista.isBullish).toBe(true)
    expect(alcista.isBearish).toBe(false)
    expect(bajista.isBullish).toBe(false)
    expect(bajista.isBearish).toBe(true)
  })

  it('una vela sin cuerpo (doji) no es ni alcista ni bajista', () => {
    const doji = Candle.from(fields({ open: 10, close: 10 }))

    expect(doji.isBullish).toBe(false)
    expect(doji.isBearish).toBe(false)
    expect(doji.bodySize).toBe(0)
  })

  it('bodySize es el tamaño absoluto del cuerpo', () => {
    expect(Candle.from(fields({ open: 10, close: 15 })).bodySize).toBe(5)
    expect(Candle.from(fields({ open: 15, close: 10 })).bodySize).toBe(5)
  })

  it('range es high - low', () => {
    expect(Candle.from(fields({ high: 16, low: 8 })).range).toBe(8)
  })

  it('equals compara por valor (todos los campos)', () => {
    expect(Candle.from(fields()).equals(Candle.from(fields()))).toBe(true)
    expect(Candle.from(fields()).equals(Candle.from(fields({ close: 12 })))).toBe(false)
    expect(Candle.from(fields()).equals(Candle.from(fields({ time: 1 })))).toBe(false)
  })

  it('serializa a JSON plano y hace round-trip con from()', () => {
    const candle = Candle.from(fields())

    expect(JSON.parse(JSON.stringify(candle))).toEqual(fields())
    expect(Candle.from(JSON.parse(JSON.stringify(candle)))).toEqual(candle)
  })
})

describe('Candle.aggregate', () => {
  it('fusiona un grupo: open primero, close último, extremos y volumen', () => {
    const group = [
      Candle.from(fields({ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 })),
      Candle.from(fields({ time: MIN, open: 11, high: 15, low: 10, close: 14, volume: 2 })),
      Candle.from(fields({ time: 2 * MIN, open: 14, high: 16, low: 13, close: 15, volume: 3 })),
    ]

    const agg = Candle.aggregate(group, Timeframe.FIVE_MINUTES)

    expect(agg).toEqual({
      time: 0, // inicio del bucket
      open: 10,
      high: 16,
      low: 9,
      close: 15,
      volume: 6,
    })
  })

  it('rebucketa la vela al inicio del bucket aunque no esté alineada', () => {
    const candle = Candle.from(fields({ time: 2 * MIN }))

    expect(Candle.aggregate([candle], Timeframe.FIVE_MINUTES).time).toBe(0)
  })

  it('ordena el grupo por tiempo si viene desordenado', () => {
    const group = [
      Candle.from(fields({ time: 2 * MIN, close: 15 })),
      Candle.from(fields({ time: 0, close: 11 })),
    ]

    const agg = Candle.aggregate(group, Timeframe.FIVE_MINUTES)

    expect(agg.open).toBe(10) // la de time 0 abre
    expect(agg.close).toBe(15) // la de time 2*MIN cierra
  })

  it('rechaza un grupo vacío', () => {
    expect(() => Candle.aggregate([], Timeframe.FIVE_MINUTES)).toThrow()
  })

  it('rechaza un valor que no es un Timeframe', () => {
    expect(() =>
      Candle.aggregate([Candle.from(fields())], 300_000 as unknown as Timeframe),
    ).toThrow(/timeframe/i)
  })

  it('no muta las velas de entrada', () => {
    const inputs = [
      Candle.from(fields({ time: 0, volume: 1 })),
      Candle.from(fields({ time: MIN, volume: 2 })),
    ]
    const before = inputs.map((c) => JSON.stringify(c))

    Candle.aggregate(inputs, Timeframe.FIVE_MINUTES)

    expect(inputs.map((c) => JSON.stringify(c))).toEqual(before)
  })
})
