import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { InvalidOrderError, Order, OrderSide, OrderType } from '@/domain/execution/order'
import {
  ExecutionModel,
  InvalidExecutionModelError,
  NextOpenExecutionModel,
} from '@/domain/execution/executionModel'

const time = 1_700_000_000_000

function candle(
  overrides: Partial<{ time: number; open: number; high: number; low: number }> = {},
) {
  const { open = 100, high = 105, low = 95 } = overrides
  return Candle.from({
    time: overrides.time ?? time,
    open,
    high,
    low,
    close: (high + low) / 2,
    volume: 10,
  })
}

function order(overrides: Partial<{ side: OrderSide; type: OrderType; price: number }> = {}) {
  return new Order({
    id: 'o1',
    side: overrides.side ?? OrderSide.Buy,
    type: overrides.type ?? OrderType.Market,
    qty: 1,
    price: overrides.price,
    createdAt: time - 60_000,
  })
}

describe('NextOpenExecutionModel — configuración', () => {
  it('por defecto no aplica slippage ni comisión', () => {
    const model = new NextOpenExecutionModel()
    const fill = model.evaluate(order(), candle({ open: 100 }))
    expect(fill).not.toBeNull()
    expect(fill?.price).toBe(100)
    expect(fill?.fee).toBe(0)
  })

  it('rechaza configuraciones no válidas', () => {
    expect(() => new NextOpenExecutionModel({ slippageBps: -1 })).toThrow(
      InvalidExecutionModelError,
    )
    expect(() => new NextOpenExecutionModel({ feeBps: Number.NaN })).toThrow(
      InvalidExecutionModelError,
    )
    expect(() => new NextOpenExecutionModel({ slippageBps: '5' as unknown as number })).toThrow(
      InvalidExecutionModelError,
    )
    expect(() => new NextOpenExecutionModel({ slippageBps: Number.POSITIVE_INFINITY })).toThrow(
      InvalidExecutionModelError,
    )
  })

  it('expone la config efectiva con los defaults ya resueltos', () => {
    expect(new NextOpenExecutionModel().config).toEqual({ slippageBps: 0, feeBps: 0 })
    expect(new NextOpenExecutionModel({ slippageBps: 10, feeBps: 25 }).config).toEqual({
      slippageBps: 10,
      feeBps: 25,
    })
  })
})

describe('NextOpenExecutionModel — órdenes de mercado', () => {
  const model = new NextOpenExecutionModel({ slippageBps: 10, feeBps: 25 }) // 0.1% / 0.25%

  it('buy se rellena al open con slippage a favor del mercado', () => {
    const fill = model.evaluate(order({ side: OrderSide.Buy }), candle({ open: 100 }))
    expect(fill).not.toBeNull()
    expect(fill?.price).toBeCloseTo(100.1, 10) // 100 * 1.001 (10 bps)
    expect(fill?.qty).toBe(1)
    expect(fill?.orderId).toBe('o1')
    expect(fill?.time).toBe(time)
  })

  it('sell se rellena al open con slippage en contra', () => {
    const fill = model.evaluate(order({ side: OrderSide.Sell }), candle({ open: 100 }))
    expect(fill?.price).toBeCloseTo(99.9, 10) // 100 * 0.999
  })

  it('la comisión se calcula sobre el precio de relleno', () => {
    const fill = model.evaluate(order({ side: OrderSide.Buy }), candle({ open: 100 }))
    expect(fill?.fee).toBeCloseTo(100.1 * 1 * 0.0025, 10)
  })

  it('siempre rellena, aunque la vela no toque el precio', () => {
    const model = new NextOpenExecutionModel()
    const fill = model.evaluate(order({ side: OrderSide.Buy }), candle({ open: 100, low: 99 }))
    expect(fill).not.toBeNull()
  })
})

describe('NextOpenExecutionModel — órdenes limit', () => {
  const model = new NextOpenExecutionModel({ slippageBps: 10, feeBps: 25 })

  it('buy: open por debajo del límite rellena al open (mejor precio que el pedido)', () => {
    const fill = model.evaluate(
      order({ type: OrderType.Limit, price: 100 }),
      candle({ open: 95, high: 98, low: 90 }),
    )
    expect(fill?.price).toBe(95)
  })

  it('buy: open por encima pero la vela toca el límite rellena al límite sin slippage', () => {
    const fill = model.evaluate(
      order({ type: OrderType.Limit, price: 100 }),
      candle({ open: 105, high: 106, low: 99 }),
    )
    expect(fill?.price).toBe(100)
  })

  it('buy: la vela no toca el límite → sin relleno', () => {
    const fill = model.evaluate(
      order({ type: OrderType.Limit, price: 100 }),
      candle({ open: 105, high: 108, low: 101 }),
    )
    expect(fill).toBeNull()
  })

  it('sell: open por encima del límite rellena al open', () => {
    const fill = model.evaluate(
      order({ side: OrderSide.Sell, type: OrderType.Limit, price: 100 }),
      candle({ open: 105, high: 110, low: 102 }),
    )
    expect(fill?.price).toBe(105)
  })

  it('sell: open por debajo pero la vela toca el límite rellena al límite', () => {
    const fill = model.evaluate(
      order({ side: OrderSide.Sell, type: OrderType.Limit, price: 100 }),
      candle({ open: 95, high: 101, low: 94 }),
    )
    expect(fill?.price).toBe(100)
  })

  it('sell: la vela no toca el límite → sin relleno', () => {
    const fill = model.evaluate(
      order({ side: OrderSide.Sell, type: OrderType.Limit, price: 100 }),
      candle({ open: 95, high: 99, low: 90 }),
    )
    expect(fill).toBeNull()
  })

  it('el toque exacto del límite (low/high) cuenta como relleno', () => {
    const buy = model.evaluate(
      order({ type: OrderType.Limit, price: 100 }),
      candle({ open: 105, high: 106, low: 100 }),
    )
    const sell = model.evaluate(
      order({ side: OrderSide.Sell, type: OrderType.Limit, price: 100 }),
      candle({ open: 95, high: 100, low: 90 }),
    )
    expect(buy?.price).toBe(100)
    expect(sell?.price).toBe(100)
  })
})

describe('NextOpenExecutionModel — contrato', () => {
  const model = new NextOpenExecutionModel()

  it('la comisión usa la configuración sin slippage en límites', () => {
    const withFee = new NextOpenExecutionModel({ slippageBps: 10, feeBps: 100 })
    const fill = withFee.evaluate(
      order({ type: OrderType.Limit, price: 100 }),
      candle({ open: 105, high: 106, low: 99 }),
    )
    expect(fill?.price).toBe(100) // sin slippage
    expect(fill?.fee).toBeCloseTo(100 * 1 * 0.01, 10)
  })

  it('evaluate solo admite órdenes pending', () => {
    const pending = order()
    pending.cancel()
    expect(() => model.evaluate(pending, candle())).toThrow(InvalidOrderError)
  })

  it('es sustituible por cualquier ExecutionModel (contrato estructural)', () => {
    const custom: ExecutionModel = { evaluate: () => null }
    expect(custom.evaluate(order(), candle())).toBeNull()
  })
})
