import { describe, expect, it } from 'vitest'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { InvalidRiskError, RiskConfig, RiskManager } from '@/domain/portfolio/riskManager'
import { buy } from '../../support/fills'

describe('RiskManager — configuración', () => {
  it('acepta una configuración válida con defaults', () => {
    const risk = new RiskManager()
    expect(risk.maxPositionFraction).toBe(1)
    expect(risk.minCashReserve).toBe(0)
    expect(risk.feeBps).toBe(0)
    expect(risk.slippageBps).toBe(0)
    expect(
      new RiskManager({ maxPositionFraction: 0.5, minCashReserve: 0.1 }).maxPositionFraction,
    ).toBe(0.5)
  })

  it.each([
    ['maxPositionFraction 0', { maxPositionFraction: 0 }],
    ['maxPositionFraction > 1', { maxPositionFraction: 1.5 }],
    ['maxPositionFraction no finito', { maxPositionFraction: Number.NaN }],
    ['maxPositionFraction no number', { maxPositionFraction: '0.5' }],
    ['minCashReserve negativo', { minCashReserve: -0.1 }],
    ['minCashReserve >= 1', { minCashReserve: 1 }],
    ['feeBps negativo', { feeBps: -1 }],
    ['feeBps no finito', { feeBps: Number.POSITIVE_INFINITY }],
    ['slippageBps negativo', { slippageBps: -1 }],
    ['slippageBps no finito', { slippageBps: Number.NaN }],
  ] as const)('rechaza %s', (_label, config) => {
    expect(() => new RiskManager(config as unknown as RiskConfig)).toThrow(InvalidRiskError)
  })

  it('expone la config efectiva con los defaults ya resueltos', () => {
    expect(new RiskManager().config).toEqual({
      maxPositionFraction: 1,
      minCashReserve: 0,
      feeBps: 0,
      slippageBps: 0,
    })
    expect(new RiskManager({ maxPositionFraction: 0.5, feeBps: 25 }).config).toEqual({
      maxPositionFraction: 0.5,
      minCashReserve: 0,
      feeBps: 25,
      slippageBps: 0,
    })
  })
})

describe('RiskManager — entryQty (tamaño de la entrada)', () => {
  it('sizea la entrada como fracción del equity', () => {
    const portfolio = new Portfolio(1_000)
    const risk = new RiskManager({ maxPositionFraction: 0.5 })
    expect(risk.entryQty(portfolio, 100)).toBeCloseTo(5, 10) // 500 / 100
  })

  it('limita por el efectivo disponible menos la reserva', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(9, 100)) // cash 100, equity 1000
    const risk = new RiskManager({ minCashReserve: 0.2 }) // reserva 200 > cash → no fondos
    expect(risk.entryQty(portfolio, 100)).toBeNull()
  })

  it('usa los fondos disponibles cuando la reserva deja margen', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(4, 100)) // cash 600, equity 1000
    const risk = new RiskManager({ minCashReserve: 0.5 }) // reserva 500 → fondos 100
    expect(risk.entryQty(portfolio, 100)).toBeCloseTo(1, 10)
  })

  it('reserva el coste de la comisión estimada (feeBps)', () => {
    const portfolio = new Portfolio(1_000)
    const risk = new RiskManager({ maxPositionFraction: 1, feeBps: 100 }) // 1%
    // 1000 / (100 * 1.01) = 9.9009…
    expect(risk.entryQty(portfolio, 100)).toBeCloseTo(1_000 / 101, 10)
  })

  it('reserva slippage y comisión de forma multiplicativa (coherente con el modelo)', () => {
    const portfolio = new Portfolio(1_000)
    const risk = new RiskManager({ slippageBps: 10, feeBps: 10 })
    // 1000 / (100 * 1.001 * 1.001)
    expect(risk.entryQty(portfolio, 100)).toBeCloseTo(1_000 / (100 * 1.001 * 1.001), 9)
    expect(risk.addQty(portfolio, 100, 1)).toBeCloseTo(1_000 / (100 * 1.001 * 1.001), 9)
  })

  it('devuelve null sin efectivo disponible', () => {
    const risk = new RiskManager()
    const spent = new Portfolio(100)
    spent.applyFill(buy(1, 100)) // cash 0 → sin fondos
    expect(risk.entryQty(spent, 100)).toBeNull()
  })

  it.each([0, -1, Number.NaN] as const)('entryQty rechaza price %s → InvalidRiskError', (price) => {
    const risk = new RiskManager()
    const portfolio = new Portfolio(1_000)
    expect(() => risk.entryQty(portfolio, price)).toThrow(InvalidRiskError)
  })
})

describe('RiskManager — canAdd (aprobación de aumentos)', () => {
  it('aprueba un add dentro del máximo de exposición', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(4, 100)) // exposición 400, equity 1000
    const risk = new RiskManager({ maxPositionFraction: 0.5 }) // tope 500
    expect(risk.canAdd(portfolio, 100, 1)).toBe(true) // 500 <= 500
    expect(risk.canAdd(portfolio, 100, 1.01)).toBe(false) // > 500
  })

  it('aprueba un add mientras respete la reserva de efectivo', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(8, 100)) // cash 200, equity 1000
    const risk = new RiskManager({ minCashReserve: 0.2 }) // reserva 200 → fondos 0
    expect(risk.canAdd(portfolio, 100, 1)).toBe(false)
    expect(new RiskManager().canAdd(portfolio, 100, 2)).toBe(true) // sin reserva: cash 200
  })

  it('tiene en cuenta la comisión estimada al comparar con el efectivo', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(9, 100)) // cash 100
    const risk = new RiskManager({ feeBps: 100 }) // coste con fee 101 > 100
    expect(risk.canAdd(portfolio, 100, 1)).toBe(false)
    expect(new RiskManager().canAdd(portfolio, 100, 1)).toBe(true)
  })

  it.each([
    ['price cero', 0, 1],
    ['qty negativa', 100, -1],
    ['qty NaN', 100, Number.NaN],
  ] as const)('canAdd rechaza %s → InvalidRiskError', (_label, price, qty) => {
    const risk = new RiskManager()
    const portfolio = new Portfolio(1_000)
    expect(() => risk.canAdd(portfolio, price, qty)).toThrow(InvalidRiskError)
  })
})

describe('RiskManager — addQty (tamaño de los aumentos)', () => {
  it('usa la fracción del presupuesto disponible (holgura de exposición y efectivo)', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(4, 100)) // exposición 400, cash 600, equity 1000
    const risk = new RiskManager()
    // presupuesto = min(1000 - 400, 600) = 600
    expect(risk.addQty(portfolio, 100, 0.5)).toBeCloseTo(3, 10)
    expect(risk.addQty(portfolio, 100, 1)).toBeCloseTo(6, 10)
  })

  it('limita por la holgura de exposición máxima', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100)) // exposición 500, equity 1000
    const capped = new RiskManager({ maxPositionFraction: 0.6 }) // tope 600 → holgura 100
    expect(capped.addQty(portfolio, 100, 1)).toBeCloseTo(1, 10)
    // sin holgura (tope 500 = exposición) → no es admisible
    expect(new RiskManager({ maxPositionFraction: 0.5 }).addQty(portfolio, 100, 1)).toBeNull()
  })

  it('limita por la reserva de efectivo', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(4, 100)) // cash 600, equity 1000
    const risk = new RiskManager({ minCashReserve: 0.5 }) // efectivo disponible 100
    expect(risk.addQty(portfolio, 100, 1)).toBeCloseTo(1, 10)
  })

  it('reserva la comisión estimada', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(4, 100)) // cash 600, holgura 600
    const risk = new RiskManager({ feeBps: 100 }) // 1%
    // 600 / (100 * 1.01)
    expect(risk.addQty(portfolio, 100, 1)).toBeCloseTo(600 / 101, 10)
  })

  it.each([
    ['fraction cero', 100, 0],
    ['fraction > 1', 100, 1.5],
    ['fraction NaN', 100, Number.NaN],
    ['price negativo', -1, 0.5],
  ] as const)('addQty rechaza %s → InvalidRiskError', (_label, price, fraction) => {
    const risk = new RiskManager()
    const portfolio = new Portfolio(1_000)
    expect(() => risk.addQty(portfolio, price, fraction)).toThrow(InvalidRiskError)
  })
})
