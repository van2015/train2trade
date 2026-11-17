import { describe, expect, it } from 'vitest'
import { Fill, FillData, InvalidFillError } from '@/domain/execution/fill'
import { OrderSide } from '@/domain/execution/order'

const fillData = {
  orderId: 'o1',
  side: OrderSide.Buy,
  price: 100,
  qty: 2,
  fee: 0.05,
  time: 1_700_000_000_000,
}

describe('Fill — construcción', () => {
  it('conserva los datos de un relleno válido', () => {
    const fill = new Fill(fillData)
    expect(fill.orderId).toBe('o1')
    expect(fill.side).toBe(OrderSide.Buy)
    expect(fill.price).toBe(100)
    expect(fill.qty).toBe(2)
    expect(fill.fee).toBe(0.05)
    expect(fill.time).toBe(fillData.time)
  })

  it('admite fee 0 pero no negativa', () => {
    expect(() => new Fill({ ...fillData, fee: 0 })).not.toThrow()
    expect(() => new Fill({ ...fillData, fee: -0.1 })).toThrow(InvalidFillError)
  })

  it.each([
    ['orderId vacío', { orderId: '' }, 'el orderId no puede estar vacío'],
    ['orderId no string', { orderId: 3 }, 'el orderId no puede estar vacío'],
    ['side desconocido', { side: 'long' }, 'side debe ser "buy" o "sell"'],
    ['price cero', { price: 0 }, 'price debe ser un número finito > 0'],
    ['price negativo', { price: -1 }, 'price debe ser un número finito > 0'],
    ['price no finito', { price: Number.NaN }, 'price debe ser un número finito > 0'],
    ['qty cero', { qty: 0 }, 'qty debe ser un número finito > 0'],
    ['qty negativa', { qty: -2 }, 'qty debe ser un número finito > 0'],
    ['qty no finita', { qty: Number.POSITIVE_INFINITY }, 'qty debe ser un número finito > 0'],
    ['fee no finita', { fee: Number.NaN }, 'fee debe ser un número finito >= 0'],
    ['time no finito', { time: 'ayer' }, 'time debe ser un timestamp finito (ms)'],
  ] as const)('rechaza %s con InvalidFillError y su mensaje', (_label, overrides, message) => {
    const build = () => new Fill({ ...fillData, ...overrides } as unknown as FillData)
    expect(build).toThrow(InvalidFillError)
    expect(build).toThrow(message)
  })

  it('InvalidFillError fija this.name y formatea el valor recibido', () => {
    try {
      new Fill({ ...fillData, price: -1 })
      expect.unreachable('debería lanzar InvalidFillError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFillError)
      expect((error as InvalidFillError).name).toBe('InvalidFillError')
      expect((error as InvalidFillError).message).toContain('Relleno inválido')
      expect((error as InvalidFillError).message).toContain('(recibido: -1)')
    }
  })
})

describe('Fill — cost (fórmula única de coste real)', () => {
  it('es notional + comisión', () => {
    expect(new Fill(fillData).cost).toBeCloseTo(100 * 2 + 0.05, 10)
    expect(new Fill({ ...fillData, fee: 0 }).cost).toBe(200)
  })
})
