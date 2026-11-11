import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Broker } from '@/domain/execution/broker'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import {
  InvalidOrderError,
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from '@/domain/execution/order'
import { NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { InvalidPortfolioError, Portfolio } from '@/domain/portfolio/portfolio'

const t0 = 1_700_000_000_000
const step = 60_000

function candleAt(index: number, overrides: { open?: number; high?: number; low?: number } = {}) {
  const { open = 100, high = 110, low = 90 } = overrides
  return Candle.from({
    time: t0 + index * step,
    open,
    high,
    low,
    close: (high + low) / 2,
    volume: 10,
  })
}

function order(
  id: string,
  overrides: Partial<{ side: OrderSide; type: OrderType; price: number; qty: number }> = {},
) {
  return new Order({
    id,
    side: overrides.side ?? OrderSide.Buy,
    type: overrides.type ?? OrderType.Market,
    qty: overrides.qty ?? 1,
    price: overrides.price,
    createdAt: t0 - step,
  })
}

function makeBroker(portfolio = new Portfolio(1_000)): HistoricalBroker {
  return new HistoricalBroker(portfolio, new NextOpenExecutionModel())
}

describe('HistoricalBroker — envío y avance', () => {
  it('submitOrder registra la orden pendiente sin tocar el portfolio', () => {
    const broker = makeBroker()
    const submitted = broker.submitOrder(order('o1'))
    expect(submitted).toBeInstanceOf(Order)
    expect(broker.pendingOrders().map((pending) => pending.id)).toEqual(['o1'])
    expect(broker.positions()).toEqual([])
    expect(broker.portfolio.cash).toBe(1_000)
  })

  it('submitOrder rechaza una orden que no está pending', () => {
    const broker = makeBroker()
    const filled = order('o1')
    filled.cancel()
    expect(() => broker.submitOrder(filled)).toThrow(InvalidOrderError)
    expect(broker.pendingOrders()).toEqual([])
  })

  it('advance rellena una orden de mercado al open y actualiza portfolio y posición', () => {
    const broker = makeBroker()
    const market = broker.submitOrder(order('o1', { qty: 2 }))
    const fills = broker.advance(candleAt(0, { open: 100 }))

    expect(fills).toHaveLength(1)
    expect(fills[0]?.price).toBe(100)
    expect(fills[0]?.qty).toBe(2)
    expect(market.status).toBe(OrderStatus.Filled)
    expect(broker.portfolio.cash).toBe(800)
    expect(broker.portfolio.position?.qty).toBe(2)
    expect(broker.pendingOrders()).toEqual([])
    expect(broker.positions().map((position) => position.qty)).toEqual([2])
  })

  it('advance mantiene pendiente una orden limit que la vela no toca y la rellena después', () => {
    const broker = makeBroker()
    const limit = broker.submitOrder(order('o1', { type: OrderType.Limit, price: 95, qty: 1 }))

    expect(broker.advance(candleAt(0, { open: 100, low: 96 }))).toEqual([])
    expect(limit.status).toBe(OrderStatus.Pending)

    const fills = broker.advance(candleAt(1, { open: 94, low: 94, high: 99 }))
    expect(fills).toHaveLength(1)
    expect(fills[0]?.price).toBe(94) // open mejor que el límite
    expect(limit.status).toBe(OrderStatus.Filled)
  })

  it('las órdenes pendientes se evalúan en orden de envío en cada vela', () => {
    const broker = makeBroker()
    const first = broker.submitOrder(order('o1', { qty: 1 }))
    const second = broker.submitOrder(order('o2', { qty: 1 }))
    const fills = broker.advance(candleAt(0, { open: 100 }))
    expect(fills.map((fill) => fill.orderId)).toEqual(['o1', 'o2'])
    expect(first.status).toBe(OrderStatus.Filled)
    expect(second.status).toBe(OrderStatus.Filled)
    expect(broker.portfolio.cash).toBe(800)
  })
})

describe('HistoricalBroker — rechazos controlados', () => {
  it('rechaza una compra que el efectivo no cubre, sin tocar el portfolio', () => {
    const broker = makeBroker(new Portfolio(100))
    const orderToReject = broker.submitOrder(
      order('o1', { qty: 2, type: OrderType.Limit, price: 100 }),
    )
    // tope: coste 200 > cash 100
    const fills = broker.advance(candleAt(0, { open: 100, low: 99 }))

    expect(fills).toEqual([])
    expect(orderToReject.status).toBe(OrderStatus.Rejected)
    expect(orderToReject.rejectReason).toBe('efectivo insuficiente')
    expect(broker.portfolio.cash).toBe(100)
    expect(broker.portfolio.position).toBeNull()
    expect(broker.pendingOrders()).toEqual([])
  })

  it('rechaza una venta sin posición abierta (long-only)', () => {
    const broker = makeBroker()
    const sellOrder = broker.submitOrder(order('o1', { side: OrderSide.Sell }))
    const fills = broker.advance(candleAt(0, { open: 100 }))
    expect(fills).toEqual([])
    expect(sellOrder.status).toBe(OrderStatus.Rejected)
    expect(sellOrder.rejectReason).toBe('sin posición abierta')
    expect(broker.portfolio.cash).toBe(1_000)
  })

  it('rechaza una venta superior a la posición abierta sin mutar el portfolio', () => {
    const broker = makeBroker()
    broker.submitOrder(order('entry', { qty: 1 }))
    broker.advance(candleAt(0, { open: 100 }))
    const cashAfterEntry = broker.portfolio.cash

    const oversell = broker.submitOrder(order('over', { side: OrderSide.Sell, qty: 5 }))
    const fills = broker.advance(candleAt(1, { open: 110 }))
    expect(fills).toEqual([])
    expect(oversell.status).toBe(OrderStatus.Rejected)
    expect(oversell.rejectReason).toBe('sin posición suficiente')
    expect(broker.portfolio.cash).toBe(cashAfterEntry)
    expect(broker.portfolio.position?.qty).toBe(1)
  })
})

describe('HistoricalBroker — cancelación', () => {
  it('cancelOrder cancela y retira la orden pendiente', () => {
    const broker = makeBroker()
    const limit = broker.submitOrder(order('o1', { type: OrderType.Limit, price: 95 }))
    broker.cancelOrder('o1')
    expect(limit.status).toBe(OrderStatus.Cancelled)
    expect(broker.pendingOrders()).toEqual([])
    expect(broker.advance(candleAt(0, { open: 90, low: 89 }))).toEqual([])
    expect(broker.portfolio.position).toBeNull()
  })

  it('cancelOrder con id inexistente o ya resuelta lanza InvalidOrderError', () => {
    const broker = makeBroker()
    expect(() => broker.cancelOrder('no-existe')).toThrow(InvalidOrderError)

    broker.submitOrder(order('o1'))
    broker.advance(candleAt(0, { open: 100 }))
    expect(() => broker.cancelOrder('o1')).toThrow(InvalidOrderError)
  })
})

describe('HistoricalBroker — configuración', () => {
  it('por defecto usa NextOpenExecutionModel sin slippage ni comisión', () => {
    const broker = new HistoricalBroker(new Portfolio(1_000))
    broker.submitOrder(order('o1'))
    const fills = broker.advance(candleAt(0, { open: 100 }))
    expect(fills[0]?.price).toBe(100)
    expect(fills[0]?.fee).toBe(0)
  })

  it('con un modelo con comisión la descuenta el portfolio', () => {
    const broker = new HistoricalBroker(
      new Portfolio(1_000),
      new NextOpenExecutionModel({ feeBps: 100 }), // 1%
    )
    broker.submitOrder(order('o1', { qty: 1 }))
    const fills = broker.advance(candleAt(0, { open: 100 }))
    expect(fills[0]?.fee).toBeCloseTo(1, 10)
    expect(broker.portfolio.cash).toBeCloseTo(899, 10)
    expect(broker.portfolio.feesPaid).toBeCloseTo(1, 10)
  })

  it('cumple el contrato Broker (sustituible por cualquier implementación)', () => {
    const broker: Broker = makeBroker()
    expect(typeof broker.submitOrder).toBe('function')
    expect(typeof broker.cancelOrder).toBe('function')
    expect(typeof broker.advance).toBe('function')
    expect(typeof broker.positions).toBe('function')
    expect(() => broker.advance(candleAt(0))).not.toThrow()
  })
})

describe('HistoricalBroker — ciclo entrada/salida', () => {
  it('ejecuta una entrada y una salida completas contra el portfolio', () => {
    const broker = makeBroker()
    broker.submitOrder(order('entry', { qty: 5 }))
    broker.advance(candleAt(0, { open: 100 })) // cash 500, posición 5

    broker.submitOrder(order('exit', { side: OrderSide.Sell, qty: 5 }))
    const fills = broker.advance(candleAt(1, { open: 110 })) // cash 1050

    expect(fills).toHaveLength(1)
    expect(broker.portfolio.cash).toBe(1_050)
    expect(broker.portfolio.position).toBeNull()
    expect(broker.portfolio.realizedPnl).toBe(50)
    expect(broker.positions()).toEqual([])
  })
})
