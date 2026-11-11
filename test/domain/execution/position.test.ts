import { describe, expect, it } from 'vitest'
import { Fill } from '@/domain/execution/fill'
import { InvalidPositionError, Position } from '@/domain/execution/position'
import { OrderSide } from '@/domain/execution/order'

const t0 = 1_700_000_000_000
const t1 = t0 + 60_000
const t2 = t0 + 120_000

function buy(qty: number, price: number, time = t0, fee = 0): Fill {
  return new Fill({ orderId: 'b', side: OrderSide.Buy, price, qty, fee, time })
}

function sell(qty: number, price: number, time = t1, fee = 0): Fill {
  return new Fill({ orderId: 's', side: OrderSide.Sell, price, qty, fee, time })
}

describe('Position — apertura', () => {
  it('la primera compra abre la posición con avgEntry = precio', () => {
    const position = Position.from(buy(2, 100))
    expect(position.qty).toBe(2)
    expect(position.avgEntryPrice).toBe(100)
    expect(position.openedAt).toBe(t0)
    expect(position.isOpen).toBe(true)
    expect(position.isEmpty).toBe(false)
    expect(position.realizedPnl).toBe(0)
    expect(position.feesPaid).toBe(0)
  })

  it('la comisión de entrada sube el coste unitario (avgEntry incluye fees)', () => {
    const position = Position.from(buy(2, 100, t0, 0.5))
    expect(position.avgEntryPrice).toBeCloseTo(100.25, 10) // (200 + 0.5) / 2
    expect(position.feesPaid).toBeCloseTo(0.5, 10)
  })

  it('vender sobre posición vacía es un error', () => {
    expect(() => Position.from(sell(1, 100))).toThrow(InvalidPositionError)
  })
})

describe('Position — compras posteriores (Add)', () => {
  it('promedia ponderadoamente las entradas', () => {
    const position = Position.from(buy(2, 100))
    position.applyFill(buy(2, 110, t1))
    expect(position.qty).toBe(4)
    expect(position.avgEntryPrice).toBeCloseTo(105, 10)
    expect(position.realizedPnl).toBe(0)
  })

  it('acumula las comisiones de todas las entradas en el coste y en feesPaid', () => {
    const position = Position.from(buy(1, 100, t0, 1))
    position.applyFill(buy(1, 110, t1, 2))
    expect(position.qty).toBe(2)
    expect(position.avgEntryPrice).toBeCloseTo(106.5, 10) // (100 + 1 + 110 + 2) / 2
    expect(position.feesPaid).toBeCloseTo(3, 10)
  })
})

describe('Position — ventas (Reduce / Exit)', () => {
  it('una venta parcial realiza beneficio y reduce qty sin tocar avgEntry', () => {
    const position = Position.from(buy(4, 100))
    position.applyFill(sell(1, 110))
    expect(position.qty).toBe(3)
    expect(position.avgEntryPrice).toBe(100)
    expect(position.realizedPnl).toBeCloseTo(10, 10) // (110 - 100) * 1
  })

  it('una venta parcial con pérdida realiza pérdida', () => {
    const position = Position.from(buy(4, 100))
    position.applyFill(sell(2, 90))
    expect(position.qty).toBe(2)
    expect(position.realizedPnl).toBeCloseTo(-20, 10)
  })

  it('la comisión de salida descuenta del realizado', () => {
    const position = Position.from(buy(4, 100))
    position.applyFill(sell(1, 110, t1, 0.5))
    expect(position.realizedPnl).toBeCloseTo(9.5, 10)
    expect(position.feesPaid).toBeCloseTo(0.5, 10)
  })

  it('el cierre total deja la posición vacía y acumula el realizado', () => {
    const position = Position.from(buy(2, 100))
    position.applyFill(sell(1, 95, t1))
    position.applyFill(sell(1, 105, t2))
    expect(position.qty).toBe(0)
    expect(position.isEmpty).toBe(true)
    expect(position.isOpen).toBe(false)
    expect(position.realizedPnl).toBeCloseTo(0, 10) // (95 - 100) + (105 - 100) = 0
  })

  it('vender más de la posición abierta es un error', () => {
    const position = Position.from(buy(1, 100))
    expect(() => position.applyFill(sell(1.5, 100))).toThrow(InvalidPositionError)
    expect(position.qty).toBe(1) // sin cambios
  })

  it('operar sobre una posición ya cerrada es un error', () => {
    const position = Position.from(buy(1, 100))
    position.applyFill(sell(1, 100, t1))
    expect(() => position.applyFill(buy(1, 100, t2))).toThrow(InvalidPositionError)
    expect(() => position.applyFill(sell(1, 100, t2))).toThrow(InvalidPositionError)
  })
})

describe('Position — consultas de mercado', () => {
  it('unrealizedPnl y marketValue respecto al precio actual', () => {
    const position = Position.from(buy(2, 100, t0, 1))
    expect(position.marketValue(110)).toBeCloseTo(220, 10)
    // coste unitario 100.5 → (110 - 100.5) * 2
    expect(position.unrealizedPnl(110)).toBeCloseTo(19, 10)
    expect(position.unrealizedPnl(90)).toBeCloseTo(-21, 10)
  })
})

describe('Position — realizedPnlFor (fórmula única del P&L de venta)', () => {
  it('coincide con el incremento de realizedPnl al aplicar la venta', () => {
    const position = Position.from(buy(4, 100, t0, 2)) // avgEntry 100.5
    const fill = sell(2, 110, t1, 1)
    const pnl = position.realizedPnlFor(fill)
    expect(pnl).toBeCloseTo((110 - 100.5) * 2 - 1, 10) // 18

    position.applyFill(fill)
    expect(position.realizedPnl).toBeCloseTo(pnl, 10)
  })

  it('rechaza un relleno de compra', () => {
    const position = Position.from(buy(2, 100))
    expect(() => position.realizedPnlFor(buy(1, 110))).toThrow(InvalidPositionError)
  })

  it('sigue siendo válida tras cerrar la posición (la usa RecordingBroker)', () => {
    const position = Position.from(buy(2, 100))
    position.applyFill(sell(2, 90, t1))
    expect(position.isEmpty).toBe(true)
    expect(position.realizedPnlFor(sell(1, 95, t2))).toBeCloseTo((95 - 100) * 1, 10)
  })
})
