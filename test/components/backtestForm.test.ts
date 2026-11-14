import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, validate } from '@/components/backtestForm'

describe('validate — formulario compartido de parámetros', () => {
  it('los defaults parsean a números válidos', () => {
    expect(validate(DEFAULT_PARAMS)).toEqual({
      ok: true,
      capital: 1000,
      feeBps: 0,
      slippageBps: 0,
    })
  })

  it.each([
    ['capital vacío', { capital: '' }, 'Capital inicial'],
    ['capital cero', { capital: '0' }, 'Capital inicial'],
    ['capital no numérico', { capital: 'x' }, 'Capital inicial'],
    ['comisión negativa', { feeBps: '-1' }, 'Comisión (bps)'],
    ['slippage negativo', { slippageBps: '-2' }, 'Slippage (bps)'],
  ] as const)('%s → error con el campo en el mensaje', (_label, override, fragment) => {
    const result = validate({ ...DEFAULT_PARAMS, ...override })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(fragment)
  })

  it('acepta capital fraccionario y bps >= 0', () => {
    expect(validate({ capital: '0.5', feeBps: '0', slippageBps: '10' })).toEqual({
      ok: true,
      capital: 0.5,
      feeBps: 0,
      slippageBps: 10,
    })
  })
})
