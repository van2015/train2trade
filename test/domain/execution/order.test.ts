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
    ['id vacío', { id: '   ' }, 'el id no puede estar vacío'],
    ['id no string', { id: 7 }, 'el id no puede estar vacío'],
    ['qty cero', { qty: 0 }, 'qty debe ser un número finito > 0'],
    ['qty negativa', { qty: -1 }, 'qty debe ser un número finito > 0'],
    ['qty no finita', { qty: Number.NaN }, 'qty debe ser un número finito > 0'],
    ['qty no number', { qty: '2' }, 'qty debe ser un número finito > 0'],
    [
      'createdAt no finito',
      { createdAt: Number.POSITIVE_INFINITY },
      'createdAt debe ser un timestamp finito (ms)',
    ],
    ['side desconocido', { side: 'long' }, 'side debe ser "buy" o "sell"'],
    ['type desconocido', { type: 'stop' }, 'type debe ser "market" o "limit"'],
  ] as const)('rechaza %s con InvalidOrderError y su mensaje', (_label, overrides, message) => {
    expect(() => marketBuy(overrides)).toThrow(InvalidOrderError)
    expect(() => marketBuy(overrides)).toThrow(message)
  })

  const LIMIT: OrderData = {
    id: 'o3',
    side: OrderSide.Buy,
    type: OrderType.Limit,
    qty: 1,
    createdAt,
  }
  const badPrices: Array<[string, number | null | undefined]> = [
    ['price ausente', undefined],
    ['price cero', 0],
    ['price negativo', -5],
    ['price NaN', Number.NaN],
    ['price no number', '100' as unknown as number],
  ]

  it.each(badPrices)('una orden limit: %s → InvalidOrderError', (_label, price) => {
    expect(() => new Order({ ...LIMIT, price })).toThrow(InvalidOrderError)
    expect(() => new Order({ ...LIMIT, price })).toThrow(
      'una orden limit requiere un price finito > 0',
    )
  })

  it.each([100, null] as const)('una orden de mercado no admite price: %s', (price) => {
    expect(() => marketBuy({ price })).toThrow(InvalidOrderError)
    expect(() => marketBuy({ price })).toThrow('una orden de mercado no admite price')
  })

  it('InvalidOrderError fija this.name y formatea el valor recibido', () => {
    try {
      marketBuy({ qty: 0 })
      expect.unreachable('debería lanzar InvalidOrderError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderError)
      expect((error as InvalidOrderError).name).toBe('InvalidOrderError')
      expect((error as InvalidOrderError).message).toContain('Orden inválida')
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

  it('reject con motivo vacío o solo espacios → InvalidOrderError', () => {
    expect(() => marketBuy().reject('   ')).toThrow('reject requiere un motivo no vacío')
    expect(() => marketBuy().reject(3 as never)).toThrow(InvalidOrderError)
  })

  it('el error de limit sin price informa (recibido: null)', () => {
    expect(
      () =>
        new Order({
          id: 'o-limit',
          side: OrderSide.Buy,
          type: OrderType.Limit,
          qty: 1,
          createdAt,
        }),
    ).toThrow('(recibido: null)')
  })

  it.each([
    ['fill', (order: Order) => order.fill()],
    ['cancel', (order: Order) => order.cancel()],
    ['reject', (order: Order) => order.reject('x')],
  ] as const)('%s dos veces lanza InvalidOrderError', (label, transition) => {
    const order = marketBuy()
    transition(order)
    expect(() => transition(order)).toThrow(InvalidOrderError)
    expect(() => transition(order)).toThrow(`${label} no es aplicable en`)
  })

  it.each([
    ['fill', (order: Order) => order.fill()],
    ['cancel', (order: Order) => order.cancel()],
    ['reject', (order: Order) => order.reject('x')],
  ] as const)('%s tras cancelar lanza InvalidOrderError', (label, transition) => {
    const order = marketBuy()
    order.cancel()
    expect(() => transition(order)).toThrow(InvalidOrderError)
    expect(() => transition(order)).toThrow(`${label} no es aplicable en`)
  })

  it('reject exige un motivo no vacío', () => {
    expect(() => marketBuy().reject('')).toThrow(InvalidOrderError)
    expect(() => marketBuy().reject('')).toThrow('reject requiere un motivo no vacío')
    expect(() => marketBuy().reject(42 as unknown as string)).toThrow(InvalidOrderError)
  })
})
