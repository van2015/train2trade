import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Constant, InvalidConstantError } from '@/domain/indicators/constant'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

describe('Constant', () => {
  it('devuelve el mismo valor en todas las velas, alineado por time', () => {
    expect(new Constant(30).calculate(CANDLES)).toEqual(
      CANDLES.map((entry) => ({ time: entry.time, value: 30 })),
    )
  })

  it('name es "const" (identificador estable del tipo)', () => {
    expect(new Constant(30).name).toBe('const')
  })

  it('la salida sigue el orden ascendente aunque la entrada no lo esté', () => {
    const reversed = [...CANDLES].reverse()

    expect(new Constant(2).calculate(reversed).map((entry) => entry.time)).toEqual([
      1000, 2000, 3000, 4000,
    ])
  })

  it('velas vacías → []', () => {
    expect(new Constant(1).calculate([])).toEqual([])
  })

  it('valor no finito o no numérico → InvalidConstantError con name', () => {
    try {
      new Constant(Number.NaN)
      throw new Error('debía lanzar InvalidConstantError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConstantError)
      expect((error as Error).name).toBe('InvalidConstantError')
    }
    expect(() => new Constant(Number.POSITIVE_INFINITY)).toThrow(InvalidConstantError)
    expect(() => new Constant('30' as unknown as number)).toThrow(InvalidConstantError)
  })
})
