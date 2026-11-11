import { describe, expect, it } from 'vitest'
import {
  InvalidOrderError,
  Order,
  OrderData,
  OrderSide,
  OrderStatus,
  OrderType,
} from '@/domain/execution/order'

const createdAt = 1_700_000_000_000

function marketBuy(overrides: Record<string, unknown> = {}): Order {
  return new Order({
    id: 'o1',
    side: OrderSide.Buy,
    type: OrderType.Market,
    qty: 1,
    createdAt,
    ...overrides,
  } as unknown as OrderData)
}

describe('Order — construcción', () => {
  it('una orden de mercado no admite price y la expone como null', () => {
    const order = marketBuy()
    expect(order.id).toBe('o1')
    expect(order.side).toBe(OrderSide.Buy)
    expect(order.type).toBe(OrderType.Market)
    expect(order.qty).toBe(1)
    expect(order.price).toBeNull()
    expect(order.createdAt).toBe(createdAt)
    expect(order.status).toBe(OrderStatus.Pending)
    expect(order.rejectReason).toBeNull()
    expect(order.isPending).toBe(true)
  })

  it('una orden limit conserva su price', () => {
    const order = new Order({
      id: 'o2',
      side: OrderSide.Sell,
      type: OrderType.Limit,
      qty: 0.5,
      price: 42_100.5,
      createdAt,
    })
    expect(order.price).toBe(42_100.5)
    expect(order.status).toBe(OrderStatus.Pending)
  })

  it.each([
    ['id vacío', { id: '   ' }],
    ['id no string', { id: 7 }],
    ['qty cero', { qty: 0 }],
    ['qty negativa', { qty: -1 }],
    ['qty no finita', { qty: Number.NaN }],
    ['qty no number', { qty: '2' }],
    ['createdAt no finito', { createdAt: Number.POSITIVE_INFINITY }],
    ['side desconocido', { side: 'long' }],
    ['type desconocido', { type: 'stop' }],
  ] as const)('rechaza %s con InvalidOrderError', (_label, overrides) => {
    expect(() => marketBuy(overrides)).toThrow(InvalidOrderError)
  })

  it('una orden limit exige un price finito > 0', () => {
    const base: OrderData = {
      id: 'o3',
      side: OrderSide.Buy,
      type: OrderType.Limit,
      qty: 1,
      createdAt,
    }
    expect(() => new Order(base)).toThrow(InvalidOrderError)
    expect(() => new Order({ ...base, price: 0 })).toThrow(InvalidOrderError)
    expect(() => new Order({ ...base, price: -5 })).toThrow(InvalidOrderError)
    expect(() => new Order({ ...base, price: Number.NaN })).toThrow(InvalidOrderError)
    expect(() => new Order({ ...base, price: '100' as unknown as number })).toThrow(
      InvalidOrderError,
    )
  })

  it('una orden de mercado no admite price', () => {
    expect(() => marketBuy({ price: 100 })).toThrow(InvalidOrderError)
    expect(() => marketBuy({ price: null })).toThrow(InvalidOrderError)
  })

  it('el error fija this.name y formatea el valor recibido', () => {
    try {
      marketBuy({ qty: 0 })
      expect.unreachable('debería lanzar InvalidOrderError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderError)
      expect((error as InvalidOrderError).name).toBe('InvalidOrderError')
      expect((error as InvalidOrderError).message).toContain('(recibido: 0)')
    }
  })
})

describe('Order — transiciones de estado', () => {
  it('fill pasa de pending a filled y desactiva isPending', () => {
    const order = marketBuy()
    order.fill()
    expect(order.status).toBe(OrderStatus.Filled)
    expect(order.isPending).toBe(false)
  })

  it('cancel pasa de pending a cancelled', () => {
    const order = marketBuy()
    order.cancel()
    expect(order.status).toBe(OrderStatus.Cancelled)
    expect(order.isPending).toBe(false)
  })

  it('reject guarda el motivo y pasa a rejected', () => {
    const order = marketBuy()
    order.reject('capital insuficiente')
    expect(order.status).toBe(OrderStatus.Rejected)
    expect(order.rejectReason).toBe('capital insuficiente')
  })

  it.each([
    ['fill', (order: Order) => order.fill()],
    ['cancel', (order: Order) => order.cancel()],
    ['reject', (order: Order) => order.reject('x')],
  ] as const)('%s dos veces lanza InvalidOrderError', (_label, transition) => {
    const order = marketBuy()
    transition(order)
    expect(() => transition(order)).toThrow(InvalidOrderError)
  })

  it.each([
    ['fill', (order: Order) => order.fill()],
    ['cancel', (order: Order) => order.cancel()],
    ['reject', (order: Order) => order.reject('x')],
  ] as const)('%s tras cancelar lanza InvalidOrderError', (_label, transition) => {
    const order = marketBuy()
    order.cancel()
    expect(() => transition(order)).toThrow(InvalidOrderError)
  })

  it('reject exige un motivo no vacío', () => {
    expect(() => marketBuy().reject('')).toThrow(InvalidOrderError)
    expect(() => marketBuy().reject(42 as unknown as string)).toThrow(InvalidOrderError)
  })
})
