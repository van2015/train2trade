import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Candle, InvalidCandlesError, type CandleFields } from '@/domain/candles/candle'
import { InvalidPriceError, LevelPosition, PricePosition } from '@/domain/candles/pricePosition'
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

describe('Candle.positionOf', () => {
  // Fixture: open 10, high 12, low 9, close 11 → rango [9, 12], cuerpo [10, 11]
  const candle = Candle.from(fields())

  it('precio por encima del máximo → Above', () => {
    expect(candle.positionOf(12.01)).toBe(PricePosition.Above)
    expect(candle.positionOf(1000)).toBe(PricePosition.Above)
  })

  it('precio por debajo del mínimo → Below', () => {
    expect(candle.positionOf(8.99)).toBe(PricePosition.Below)
    expect(candle.positionOf(-100)).toBe(PricePosition.Below)
  })

  it('precio en la mecha superior → UpperWick', () => {
    expect(candle.positionOf(11.5)).toBe(PricePosition.UpperWick)
  })

  it('precio en la mecha inferior → LowerWick', () => {
    expect(candle.positionOf(9.5)).toBe(PricePosition.LowerWick)
  })

  it('precio en el cuerpo → Body', () => {
    expect(candle.positionOf(10.5)).toBe(PricePosition.Body)
  })

  it('bordes: high/low caen en mechas y open/close en el cuerpo', () => {
    expect(candle.positionOf(12)).toBe(PricePosition.UpperWick) // high
    expect(candle.positionOf(9)).toBe(PricePosition.LowerWick) // low
    expect(candle.positionOf(10)).toBe(PricePosition.Body) // open
    expect(candle.positionOf(11)).toBe(PricePosition.Body) // close
  })

  it('cuerpo que toca el máximo: high es Body y no hay mecha superior', () => {
    const touching = Candle.from(fields({ open: 10, close: 12, high: 12, low: 9 }))

    expect(touching.positionOf(12)).toBe(PricePosition.Body)
    expect(touching.positionOf(11)).toBe(PricePosition.Body)
    expect(touching.positionOf(12.5)).toBe(PricePosition.Above)
  })

  it('doji: el cuerpo es un punto y el resto son mechas', () => {
    const doji = Candle.from(fields({ open: 10, close: 10, high: 12, low: 9 }))

    expect(doji.positionOf(10)).toBe(PricePosition.Body)
    expect(doji.positionOf(11)).toBe(PricePosition.UpperWick)
    expect(doji.positionOf(9.5)).toBe(PricePosition.LowerWick)
  })

  it('vela de un solo precio: solo ese valor es Body', () => {
    const flat = Candle.from(fields({ open: 10, close: 10, high: 10, low: 10 }))

    expect(flat.positionOf(10)).toBe(PricePosition.Body)
    expect(flat.positionOf(10.0001)).toBe(PricePosition.Above)
    expect(flat.positionOf(9.9999)).toBe(PricePosition.Below)
  })

  it('vela bajista: el cuerpo va de close (mín) a open (máx)', () => {
    const bearish = Candle.from(fields({ open: 15, close: 10, high: 16, low: 9 }))

    expect(bearish.positionOf(15.5)).toBe(PricePosition.UpperWick)
    expect(bearish.positionOf(12)).toBe(PricePosition.Body)
    expect(bearish.positionOf(9.5)).toBe(PricePosition.LowerWick)
  })

  it('rechaza precios no finitos', () => {
    expect(() => candle.positionOf(NaN)).toThrow(InvalidPriceError)
    expect(() => candle.positionOf(Infinity)).toThrow(InvalidPriceError)
    expect(() => candle.positionOf(-Infinity)).toThrow(InvalidPriceError)
    expect(() => candle.positionOf('10' as unknown as number)).toThrow(InvalidPriceError)
  })

  it('el error explica el precio recibido', () => {
    expect(() => candle.positionOf(NaN)).toThrow(/NaN/)
    expect(() => candle.positionOf('10' as unknown as number)).toThrow(/"10"/)
    expect(() => candle.positionOf(null as unknown as number)).toThrow(/null/)
  })
})

describe('Candle.contains', () => {
  const candle = Candle.from(fields()) // rango [9, 12]

  it('true dentro del rango [low, high] con bordes incluidos', () => {
    expect(candle.contains(9)).toBe(true)
    expect(candle.contains(10.5)).toBe(true)
    expect(candle.contains(12)).toBe(true)
  })

  it('false fuera del rango', () => {
    expect(candle.contains(8.99)).toBe(false)
    expect(candle.contains(12.01)).toBe(false)
  })

  it('rechaza precios no finitos', () => {
    expect(() => candle.contains(NaN)).toThrow(InvalidPriceError)
  })
})

describe('Candle.closePosition / openPosition', () => {
  const candle = Candle.from(fields()) // open 10, close 11

  it('cierre por encima del nivel → Above', () => {
    expect(candle.closePosition(10.5)).toBe(LevelPosition.Above)
    expect(candle.closesAbove(10.5)).toBe(true)
    expect(candle.closesAt(10.5)).toBe(false)
    expect(candle.closesBelow(10.5)).toBe(false)
  })

  it('cierre exactamente en el nivel → At (no es ruptura)', () => {
    expect(candle.closePosition(11)).toBe(LevelPosition.At)
    expect(candle.closesAt(11)).toBe(true)
    expect(candle.closesAbove(11)).toBe(false)
    expect(candle.closesBelow(11)).toBe(false)
  })

  it('cierre por debajo del nivel → Below', () => {
    expect(candle.closePosition(11.5)).toBe(LevelPosition.Below)
    expect(candle.closesBelow(11.5)).toBe(true)
  })

  it('apertura: mismos estados que el cierre', () => {
    expect(candle.openPosition(9.5)).toBe(LevelPosition.Above)
    expect(candle.openPosition(10)).toBe(LevelPosition.At)
    expect(candle.openPosition(10.5)).toBe(LevelPosition.Below)
    expect(candle.opensAbove(9.5)).toBe(true)
    expect(candle.opensAt(10)).toBe(true)
    expect(candle.opensBelow(10.5)).toBe(true)
  })

  it('exactamente uno de los tres booleanos es true', () => {
    for (const price of [9, 10, 10.5, 11, 12]) {
      const cierres = [candle.closesAbove(price), candle.closesAt(price), candle.closesBelow(price)]
      expect(cierres.filter(Boolean)).toHaveLength(1)

      const aperturas = [candle.opensAbove(price), candle.opensAt(price), candle.opensBelow(price)]
      expect(aperturas.filter(Boolean)).toHaveLength(1)
    }
  })

  it('rechaza niveles no finitos', () => {
    expect(() => candle.closePosition(NaN)).toThrow(InvalidPriceError)
    expect(() => candle.openPosition(Infinity)).toThrow(InvalidPriceError)
  })
})

describe('propiedades de posición (fast-check)', () => {
  const priceArb = fc.double({ noNaN: true, noDefaultInfinity: true })

  // Vela arbitraria con low <= high (cuerpo dentro o fuera del rango: positionOf
  // debe seguir siendo total y monótono aunque Candle.from admita ese caso).
  const candleArb = fc
    .record({ open: priceArb, close: priceArb, low: priceArb, high: priceArb })
    .map(({ open, close, low, high }) =>
      Candle.from({
        time: 0,
        open,
        close,
        low: Math.min(low, high),
        high: Math.max(low, high),
        volume: 1,
      }),
    )

  const RANK: Record<PricePosition, number> = {
    [PricePosition.Below]: 0,
    [PricePosition.LowerWick]: 1,
    [PricePosition.Body]: 2,
    [PricePosition.UpperWick]: 3,
    [PricePosition.Above]: 4,
  }

  it('totalidad: cualquier precio finito cae en uno de los 5 estados', () => {
    fc.assert(
      fc.property(candleArb, priceArb, (candle, price) => {
        expect(Object.values(PricePosition)).toContain(candle.positionOf(price))
      }),
    )
  })

  it('monotonía: p1 < p2 implica estado(p1) <= estado(p2)', () => {
    fc.assert(
      fc.property(candleArb, priceArb, priceArb, (candle, a, b) => {
        const [p1, p2] = a <= b ? [a, b] : [b, a]
        expect(RANK[candle.positionOf(p1)]).toBeLessThanOrEqual(RANK[candle.positionOf(p2)])
      }),
    )
  })

  it('coherencia con high/low: Above ⟺ p > high y Below ⟺ p < low', () => {
    fc.assert(
      fc.property(candleArb, priceArb, (candle, price) => {
        const position = candle.positionOf(price)
        expect(position === PricePosition.Above).toBe(price > candle.high)
        expect(position === PricePosition.Below).toBe(price < candle.low)
      }),
    )
  })

  it('contains es coherente con el rango: low <= p <= high', () => {
    fc.assert(
      fc.property(candleArb, priceArb, (candle, price) => {
        expect(candle.contains(price)).toBe(price >= candle.low && price <= candle.high)
      }),
    )
  })

  it('el nivel de cierre: exactamente uno de los tres booleanos y coherente con close', () => {
    fc.assert(
      fc.property(candleArb, priceArb, (candle, price) => {
        const flags = [candle.closesAbove(price), candle.closesAt(price), candle.closesBelow(price)]
        expect(flags.filter(Boolean)).toHaveLength(1)
        expect(candle.closesAbove(price)).toBe(candle.close > price)
        expect(candle.closesAt(price)).toBe(candle.close === price)
        expect(candle.closesBelow(price)).toBe(candle.close < price)
      }),
    )
  })

  it('el nivel de apertura: exactamente uno de los tres booleanos y coherente con open', () => {
    fc.assert(
      fc.property(candleArb, priceArb, (candle, price) => {
        const flags = [candle.opensAbove(price), candle.opensAt(price), candle.opensBelow(price)]
        expect(flags.filter(Boolean)).toHaveLength(1)
        expect(candle.opensAbove(price)).toBe(candle.open > price)
        expect(candle.opensAt(price)).toBe(candle.open === price)
        expect(candle.opensBelow(price)).toBe(candle.open < price)
      }),
    )
  })
})
