import { describe, expect, it } from 'vitest'
import { BPS, feeFor, withFee, withSlippage } from '@/domain/execution/costs'

describe('costs — aritmética de costes compartida (§6/§8)', () => {
  it('BPS es 10_000 (1 bps = 0,01 %)', () => {
    expect(BPS).toBe(10_000)
  })

  it('withSlippage desplaza el precio en bps (positivo = en contra del usuario)', () => {
    expect(withSlippage(100, 10)).toBeCloseTo(100.1, 10) // compra cara
    expect(withSlippage(100, -10)).toBeCloseTo(99.9, 10) // venta barata
    expect(withSlippage(100, 0)).toBe(100)
  })

  it('withFee aplica la comisión multiplicativamente (equivalente a price + feeFor)', () => {
    expect(withFee(100, 100)).toBeCloseTo(101, 10) // 1 % → 100 + 1
    expect(withFee(100, 0)).toBe(100)
    const price = 123.45
    expect(withFee(price, 25)).toBeCloseTo(price + feeFor(price, 25), 10)
  })

  it('feeFor cobra bps sobre el notional', () => {
    expect(feeFor(1_000, 25)).toBe(2.5) // 25 bps = 0,25 % de 1000
    expect(feeFor(1_000, 0)).toBe(0)
  })
})
