import { describe, expect, it } from 'vitest'
import { formatValue, invalidMessage } from '@/domain/errors'

describe('formatValue — valores en los mensajes de error de dominio', () => {
  it('formatea primitivas, null, arrays y objetos', () => {
    expect(formatValue('btc')).toBe('"btc"')
    expect(formatValue(null)).toBe('null')
    expect(formatValue(42)).toBe('42')
    expect(formatValue([1, 2])).toBe('un array')
    expect(formatValue({ a: 1 })).toBe('un objeto')
  })
})

describe('invalidMessage — formato estándar de validación', () => {
  it('prefijo: motivo (recibido: valor)', () => {
    expect(invalidMessage('X inválido', 'mal', 'abc')).toBe('X inválido: mal (recibido: "abc")')
    expect(invalidMessage('X inválido', 'mal', [1])).toBe('X inválido: mal (recibido: un array)')
    expect(invalidMessage('X inválido', 'mal', { a: 1 })).toBe(
      'X inválido: mal (recibido: un objeto)',
    )
  })
})
