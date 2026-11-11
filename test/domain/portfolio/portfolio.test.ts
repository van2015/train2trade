import { describe, expect, it } from 'vitest'
import { Fill } from '@/domain/execution/fill'
import { OrderSide } from '@/domain/execution/order'
import { InvalidPortfolioError, Portfolio } from '@/domain/portfolio/portfolio'

const t0 = 1_700_000_000_000
const t1 = t0 + 60_000
const t2 = t0 + 120_000

function buy(qty: number, price: number, time = t0, fee = 0): Fill {
  return new Fill({ orderId: 'b', side: OrderSide.Buy, price, qty, fee, time })
}

function sell(qty: number, price: number, time = t1, fee = 0): Fill {
  return new Fill({ orderId: 's', side: OrderSide.Sell, price, qty, fee, time })
}

describe('Portfolio — construcción', () => {
  it('empieza con el capital inicial en efectivo y sin posición', () => {
    const portfolio = new Portfolio(1_000)
    expect(portfolio.initialCapital).toBe(1_000)
    expect(portfolio.cash).toBe(1_000)
    expect(portfolio.position).toBeNull()
    expect(portfolio.realizedPnl).toBe(0)
    expect(portfolio.feesPaid).toBe(0)
    expect(portfolio.equity(50_000)).toBe(1_000)
    expect(portfolio.exposure(50_000)).toBe(0)
  })

  it.each([
    ['cero', 0],
    ['negativo', -1],
    ['no finito', Number.NaN],
    ['no number', '1000'],
  ] as const)('rechaza un capital inicial %s', (_label, capital) => {
    expect(() => new Portfolio(capital as unknown as number)).toThrow(InvalidPortfolioError)
  })
})

describe('Portfolio — compras', () => {
  it('descuenta precio * qty + fee y abre la posición', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100, t0, 1))
    expect(portfolio.cash).toBeCloseTo(499, 10)
    expect(portfolio.position?.qty).toBe(5)
    expect(portfolio.position?.avgEntryPrice).toBeCloseTo(100.2, 10)
    expect(portfolio.feesPaid).toBeCloseTo(1, 10)
    expect(portfolio.realizedPnl).toBe(0)
  })

  it('rechaza una compra sin efectivo suficiente y no cambia el estado', () => {
    const portfolio = new Portfolio(100)
    expect(() => portfolio.applyFill(buy(2, 100, t0, 0.5))).toThrow(InvalidPortfolioError)
    expect(portfolio.cash).toBe(100)
    expect(portfolio.position).toBeNull()
    expect(portfolio.feesPaid).toBe(0)
  })

  it('admite el tope exacto: cash = 0 es válido', () => {
    const portfolio = new Portfolio(100)
    portfolio.applyFill(buy(1, 100))
    expect(portfolio.cash).toBe(0)
    expect(portfolio.position?.qty).toBe(1)
  })
})

describe('Portfolio — ventas', () => {
  it('acredita price * qty - fee y acumula el realizado', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100, t0, 1))
    portfolio.applyFill(sell(2, 110, t1, 0.5))
    expect(portfolio.cash).toBeCloseTo(499 + 219.5, 10)
    expect(portfolio.position?.qty).toBe(3)
    expect(portfolio.realizedPnl).toBeCloseTo((110 - 100.2) * 2 - 0.5, 10)
    expect(portfolio.feesPaid).toBeCloseTo(1.5, 10)
  })

  it('rechaza una venta sin posición (long-only)', () => {
    const portfolio = new Portfolio(1_000)
    expect(() => portfolio.applyFill(sell(1, 100, t1))).toThrow(InvalidPortfolioError)
    expect(portfolio.cash).toBe(1_000)
  })

  it('al cerrar la posición retira la posición y acumula su realizado', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100))
    portfolio.applyFill(sell(5, 110, t1))
    expect(portfolio.position).toBeNull()
    expect(portfolio.realizedPnl).toBeCloseTo(50, 10)
    expect(portfolio.equity(999)).toBeCloseTo(1_050, 10) // cash sin posición: 1050
  })

  it('la siguiente entrada crea una posición nueva y el realizado total se conserva', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100))
    portfolio.applyFill(sell(5, 110, t1)) // +50
    portfolio.applyFill(buy(2, 200, t2, 2))
    expect(portfolio.position?.qty).toBe(2)
    expect(portfolio.position?.avgEntryPrice).toBeCloseTo(201, 10)
    expect(portfolio.realizedPnl).toBeCloseTo(50, 10)
    expect(portfolio.position?.realizedPnl).toBe(0)
  })
})

describe('Portfolio — consultas', () => {
  it('equity = cash + valor de mercado de la posición; exposure = valor de mercado', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100, t0, 1)) // cash 499
    expect(portfolio.exposure(110)).toBeCloseTo(550, 10)
    expect(portfolio.equity(110)).toBeCloseTo(499 + 550, 10)
    expect(portfolio.equity(90)).toBeCloseTo(499 + 450, 10)
  })

  it('un round-trip completo deja cash = capital inicial + realizado (sin doble conteo de fees)', () => {
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(buy(5, 100, t0, 1)) // -501
    portfolio.applyFill(sell(5, 110, t1, 1)) // +549
    expect(portfolio.position).toBeNull()
    expect(portfolio.realizedPnl).toBeCloseTo(48, 10)
    expect(portfolio.cash).toBeCloseTo(1_048, 10)
    expect(portfolio.cash).toBeCloseTo(portfolio.initialCapital + portfolio.realizedPnl, 10)
    expect(portfolio.feesPaid).toBeCloseTo(2, 10)
  })
})
