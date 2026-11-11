import { describe, expect, it } from 'vitest'
import { RecordingBroker } from '@/domain/backtest/recordingBroker'
import { Candle } from '@/domain/candles/candle'
import { Broker } from '@/domain/execution/broker'
import { NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { Order, OrderSide, OrderStatus, OrderType } from '@/domain/execution/order'
import { Portfolio } from '@/domain/portfolio/portfolio'

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
): Order {
  return new Order({
    id,
    side: overrides.side ?? OrderSide.Buy,
    type: overrides.type ?? OrderType.Market,
    qty: overrides.qty ?? 1,
    price: overrides.price,
    createdAt: t0 - step,
  })
}

function setup(feeBps = 0) {
  const portfolio = new Portfolio(1_000)
  const inner = new HistoricalBroker(portfolio, new NextOpenExecutionModel({ feeBps }))
  const broker = new RecordingBroker(inner, portfolio)
  return { portfolio, inner, broker }
}

describe('RecordingBroker — delegación', () => {
  it('se comporta igual que el broker interior (mismos fills y mismos efectos)', () => {
    const a = setup(100)
    const b = setup(100)

    const results = [a, b].map(({ broker }) => {
      broker.submitOrder(order('entry', { qty: 2 }))
      const first = broker.advance(candleAt(0, { open: 100 }))
      broker.submitOrder(order('exit', { side: OrderSide.Sell, qty: 2 }))
      const second = broker.advance(candleAt(1, { open: 110 }))
      return { first, second, positions: broker.positions().length }
    })
    expect(results[0]).toEqual(results[1])
    expect(a.portfolio.cash).toBe(b.portfolio.cash)
    expect(a.portfolio.position?.qty).toBe(b.portfolio.position?.qty)
    expect(a.portfolio.realizedPnl).toBe(b.portfolio.realizedPnl)
  })

  it('cumple el contrato Broker', () => {
    const { broker } = setup()
    const asInterface: Broker = broker
    expect(typeof asInterface.submitOrder).toBe('function')
    expect(typeof asInterface.cancelOrder).toBe('function')
    expect(typeof asInterface.advance).toBe('function')
    expect(typeof asInterface.positions).toBe('function')
    expect(typeof asInterface.pendingOrders).toBe('function')
  })
})

describe('RecordingBroker — registro de órdenes', () => {
  it('registra las órdenes enviadas con su estado final', () => {
    const { broker } = setup()
    const entry = broker.submitOrder(order('o1'))
    expect(broker.orders).toHaveLength(1)
    expect(broker.orders[0]).toBe(entry)

    broker.advance(candleAt(0, { open: 100 }))
    expect(broker.orders[0]?.status).toBe(OrderStatus.Filled)
  })

  it('una cancelación se refleja en el registro y no genera trade', () => {
    const { broker } = setup()
    const limit = broker.submitOrder(order('o1', { type: OrderType.Limit, price: 50 }))
    broker.cancelOrder('o1')

    expect(broker.orders[0]?.status).toBe(OrderStatus.Cancelled)
    expect(broker.trades).toEqual([])
    expect(limit.status).toBe(OrderStatus.Cancelled)
  })

  it('un rechazo queda registrado y no genera trade', () => {
    const { broker } = setup()
    broker.submitOrder(order('sell', { side: OrderSide.Sell })) // sin posición
    broker.advance(candleAt(0, { open: 100 }))

    expect(broker.orders[0]?.status).toBe(OrderStatus.Rejected)
    expect(broker.trades).toEqual([])
  })
})

describe('RecordingBroker — registro de trades', () => {
  it('una compra no registra trade; la venta registra uno con el estado PREVIO', () => {
    const { broker, portfolio } = setup(100) // fee 1%
    broker.submitOrder(order('entry', { qty: 2 }))
    broker.advance(candleAt(0, { open: 100 })) // buy: fee 2 → avgEntry 101, cash 798
    expect(broker.trades).toEqual([])
    expect(portfolio.position?.avgEntryPrice).toBeCloseTo(101, 10)

    broker.submitOrder(order('exit', { side: OrderSide.Sell, qty: 2 }))
    broker.advance(candleAt(1, { open: 110 })) // sell: price 110, fee 2.2

    expect(broker.trades).toHaveLength(1)
    const trade = broker.trades[0]
    expect(trade?.entryTime).toBe(candleAt(0).time)
    expect(trade?.entryPrice).toBeCloseTo(101, 10) // avgEntry previo (con fees)
    expect(trade?.exitTime).toBe(candleAt(1).time)
    expect(trade?.exitPrice).toBe(110)
    expect(trade?.qty).toBe(2)
    expect(trade?.fees).toBeCloseTo(2.2, 10)
    expect(trade?.pnl).toBeCloseTo((110 - 101) * 2 - 2.2, 10) // 15.8
    expect(trade?.win).toBe(true)
  })

  it('un cierre parcial genera un trade por relleno', () => {
    const { broker, portfolio } = setup()
    broker.submitOrder(order('entry', { qty: 2 }))
    broker.advance(candleAt(0, { open: 100 }))

    broker.submitOrder(order('r1', { side: OrderSide.Sell, qty: 1 }))
    broker.advance(candleAt(1, { open: 110 }))
    broker.submitOrder(order('r2', { side: OrderSide.Sell, qty: 1 }))
    broker.advance(candleAt(2, { open: 90 }))

    expect(broker.trades).toHaveLength(2)
    expect(broker.trades[0]?.qty).toBe(1)
    expect(broker.trades[0]?.pnl).toBeCloseTo(10, 10)
    expect(broker.trades[0]?.win).toBe(true)
    expect(broker.trades[1]?.qty).toBe(1)
    expect(broker.trades[1]?.pnl).toBeCloseTo(-10, 10)
    expect(broker.trades[1]?.win).toBe(false)
    // invariante: la suma de pnl coincide con el realizado del portfolio
    expect(broker.trades.reduce((sum, trade) => sum + trade.pnl, 0)).toBeCloseTo(
      portfolio.realizedPnl,
      10,
    )
  })

  it('invariante con fees: Σ pnl = realizedPnl tras cerrar la posición', () => {
    const { broker, portfolio } = setup(50) // 0.5%
    broker.submitOrder(order('entry', { qty: 3 }))
    broker.advance(candleAt(0, { open: 100 }))
    broker.submitOrder(order('exit', { side: OrderSide.Sell, qty: 3 }))
    broker.advance(candleAt(1, { open: 85 }))

    expect(portfolio.position).toBeNull()
    const total = broker.trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(total).toBeCloseTo(portfolio.realizedPnl, 10)
    expect(broker.trades[0]?.win).toBe(false)
  })

  it('devuelve copias: mutar el array devuelto no afecta al registro', () => {
    const { broker } = setup()
    const trades = broker.trades
    const orders = broker.orders
    expect(trades).not.toBe(broker.trades)
    expect(orders).not.toBe(broker.orders)
    expect(trades).toEqual(broker.trades)
  })
})
