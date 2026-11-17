import { describe, expect, it } from 'vitest'
import { isFiniteNumber, isPositiveNumber, isRecord } from '@/domain/guards'

describe('isRecord', () => {
  it('objetos planos sí; null, arrays y primitivos no', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(42)).toBe(false)
  })
})

describe('isFiniteNumber', () => {
  it('solo números finitos (NaN e infinitos fuera)', () => {
    expect(isFiniteNumber(1.5)).toBe(true)
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isFiniteNumber('5')).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
    expect(isFiniteNumber(undefined)).toBe(false)
  })
})

describe('isPositiveNumber', () => {
  it('finítos estrictamente positivos (cero y negativos fuera)', () => {
    expect(isPositiveNumber(1)).toBe(true)
    expect(isPositiveNumber(0.5)).toBe(true)
    expect(isPositiveNumber(0)).toBe(false)
    expect(isPositiveNumber(-5)).toBe(false)
    expect(isPositiveNumber(Number.NaN)).toBe(false)
    expect(isPositiveNumber('5')).toBe(false)
  })
})
