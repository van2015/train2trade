import { describe, expect, it } from 'vitest'
import { InvalidTradeError, Trade, TradeData } from '@/domain/execution/trade'

const entryTime = 1_700_000_000_000
const exitTime = entryTime + 60_000

const tradeData = {
  entryTime,
  entryPrice: 100,
  exitTime,
  exitPrice: 110,
  qty: 2,
  pnl: 20,
  fees: 0.1,
}

describe('Trade — construcción', () => {
  it('conserva los datos de un trade válido', () => {
    const trade = new Trade(tradeData)
    expect(trade.entryTime).toBe(entryTime)
    expect(trade.entryPrice).toBe(100)
    expect(trade.exitTime).toBe(exitTime)
    expect(trade.exitPrice).toBe(110)
    expect(trade.qty).toBe(2)
    expect(trade.pnl).toBe(20)
    expect(trade.fees).toBe(0.1)
  })

  it('win es pnl > 0 (empate no es ganancia) y durationMs la duración', () => {
    expect(new Trade(tradeData).win).toBe(true)
    expect(new Trade(tradeData).durationMs).toBe(60_000)
    expect(new Trade({ ...tradeData, pnl: 0 }).win).toBe(false)
    expect(new Trade({ ...tradeData, pnl: -5 }).win).toBe(false)
    expect(new Trade({ ...tradeData, exitTime: entryTime }).durationMs).toBe(0)
  })

  it('admite pnl negativo (pérdida) y fees 0', () => {
    const trade = new Trade({ ...tradeData, pnl: -7.5, fees: 0 })
    expect(trade.pnl).toBe(-7.5)
    expect(trade.win).toBe(false)
  })

  it.each([
    [
      'entryTime no finito',
      { entryTime: Number.NaN },
      'entryTime debe ser un timestamp finito >= 0 (ms)',
    ],
    ['entryTime negativo', { entryTime: -1 }, 'entryTime debe ser un timestamp finito >= 0 (ms)'],
    [
      'exitTime antes que entryTime',
      { exitTime: entryTime - 1 },
      'exitTime no puede ser anterior a entryTime',
    ],
    [
      'exitTime no finito',
      { exitTime: Number.POSITIVE_INFINITY },
      'exitTime debe ser un timestamp finito >= 0 (ms)',
    ],
    ['entryPrice cero', { entryPrice: 0 }, 'entryPrice debe ser un número finito > 0'],
    ['entryPrice negativo', { entryPrice: -10 }, 'entryPrice debe ser un número finito > 0'],
    ['exitPrice no finito', { exitPrice: Number.NaN }, 'exitPrice debe ser un número finito > 0'],
    ['qty cero', { qty: 0 }, 'qty debe ser un número finito > 0'],
    ['qty negativa', { qty: -1 }, 'qty debe ser un número finito > 0'],
    ['pnl no finito', { pnl: Number.NaN }, 'pnl debe ser un número finito'],
    ['fees negativas', { fees: -0.01 }, 'fees debe ser un número finito >= 0'],
    ['fees no finitas', { fees: Number.NaN }, 'fees debe ser un número finito >= 0'],
  ] as const)('rechaza %s con InvalidTradeError y su mensaje', (_label, overrides, message) => {
    expect(() => new Trade({ ...tradeData, ...overrides })).toThrow(InvalidTradeError)
    expect(() => new Trade({ ...tradeData, ...overrides })).toThrow(message)
  })

  it('InvalidTradeError fija this.name y formatea el valor recibido', () => {
    try {
      new Trade({ ...tradeData, qty: 0 })
      expect.unreachable('debería lanzar InvalidTradeError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTradeError)
      expect((error as InvalidTradeError).name).toBe('InvalidTradeError')
      expect((error as InvalidTradeError).message).toContain('Trade inválido')
      expect((error as InvalidTradeError).message).toContain('(recibido: 0)')
    }
  })
})

describe('Trade — roundtrip JSON (persistencia, Fase 6)', () => {
  it('toJSON devuelve solo los datos y JSON.stringify usa toJSON', () => {
    const trade = new Trade(tradeData)

    expect(trade.toJSON()).toEqual(tradeData)
    expect(JSON.parse(JSON.stringify(trade))).toEqual(tradeData)
  })

  it('Trade.from reconstruye un trade equivalente con los getters intactos', () => {
    const trade = new Trade(tradeData)
    const restored = Trade.from(trade.toJSON())

    expect(restored).toEqual(trade)
    expect(restored.win).toBe(true)
    expect(restored.durationMs).toBe(60_000)
  })

  const FROM_INVALID: Array<[string, () => unknown, string]> = [
    [
      'null en vez de objeto',
      () => Trade.from(null as unknown as TradeData),
      'los datos deben ser un objeto',
    ],
    [
      'qty negativa',
      () => Trade.from({ ...tradeData, qty: -1 }),
      'qty debe ser un número finito > 0',
    ],
    [
      'exitTime anterior a entryTime',
      () => Trade.from({ ...tradeData, exitTime: entryTime - 1 }),
      'exitTime no puede ser anterior a entryTime',
    ],
  ]

  it.each(FROM_INVALID)(
    'Trade.from valida %s → InvalidTradeError y su mensaje',
    (_label, build, message) => {
      expect(build).toThrow(InvalidTradeError)
      expect(build).toThrow(message)
    },
  )
})
