import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, validate } from '@/components/backtestForm'

describe('validate — formulario compartido de parámetros', () => {
  it('los defaults parsean a números válidos', () => {
    expect(validate(DEFAULT_PARAMS)).toEqual({
      ok: true,
      capital: 1000,
      feeBps: 0,
      slippageBps: 0,
      fast: 10,
      slow: 30,
    })
  })

  it.each([
    ['capital vacío', { capital: '' }, 'Capital inicial'],
    ['capital cero', { capital: '0' }, 'Capital inicial'],
    ['capital no numérico', { capital: 'x' }, 'Capital inicial'],
    ['comisión negativa', { feeBps: '-1' }, 'Comisión (bps)'],
    ['slippage negativo', { slippageBps: '-2' }, 'Slippage (bps)'],
    ['SMA rápida no entera', { fast: '2.5' }, 'SMA rápida'],
    ['SMA rápida cero', { fast: '0' }, 'SMA rápida'],
    ['SMA lenta no entera', { slow: '1.5' }, 'SMA lenta'],
    ['SMA lenta cero', { slow: '0' }, 'SMA lenta'],
  ] as const)('%s → error con el campo en el mensaje', (_label, override, fragment) => {
    const result = validate({ ...DEFAULT_PARAMS, ...override })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(fragment)
  })

  it('acepta capital fraccionario, bps >= 0 y periodos enteros >= 1', () => {
    expect(
      validate({ capital: '0.5', feeBps: '0', slippageBps: '10', fast: '1', slow: '100' }),
    ).toEqual({ ok: true, capital: 0.5, feeBps: 0, slippageBps: 10, fast: 1, slow: 100 })
  })
})
