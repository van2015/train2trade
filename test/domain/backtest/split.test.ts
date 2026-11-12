import { describe, expect, it } from 'vitest'
import { SplitError, splitCandles } from '@/domain/backtest/split'
import { Candle } from '@/domain/candles/candle'

const t0 = 1_700_000_000_000
const stepMs = 60_000

const CANDLES = Array.from({ length: 9 }, (_, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }),
)

describe('splitCandles — corte por tiempo (§7C)', () => {
  it('parte en development (< cutTime) y evaluation (>= cutTime)', () => {
    const cutTime = t0 + 4 * stepMs
    const split = splitCandles(CANDLES, cutTime)

    expect(split.cutTime).toBe(cutTime)
    expect(split.development).toHaveLength(4)
    expect(split.evaluation).toHaveLength(5)
    expect(split.development[split.development.length - 1]?.time).toBeLessThan(cutTime)
    expect(split.evaluation[0]?.time).toBe(cutTime)
    // partición completa y ordenada: no se pierde ni duplica ninguna vela
    expect([...split.development, ...split.evaluation]).toEqual(CANDLES)
  })

  it('admite un corte alineado con una vela y otro entre velas', () => {
    expect(splitCandles(CANDLES, t0 + 4 * stepMs).development).toHaveLength(4)
    expect(splitCandles(CANDLES, t0 + 4 * stepMs + 1).development).toHaveLength(5)
    expect(splitCandles(CANDLES, t0 + 4 * stepMs + 1).evaluation).toHaveLength(4)
  })

  it('exige al menos una vela en cada lado (corte estrictamente interior)', () => {
    expect(() => splitCandles(CANDLES, t0)).toThrow(SplitError) // development vacío
    expect(() => splitCandles(CANDLES, t0 - 1)).toThrow(SplitError)
    expect(() => splitCandles(CANDLES, t0 + CANDLES.length * stepMs)).toThrow(SplitError) // evaluation vacío

    // extremos válidos: una sola vela a un lado
    expect(splitCandles(CANDLES, t0 + 1).development).toHaveLength(1)
    const lastTime = t0 + 8 * stepMs
    expect(splitCandles(CANDLES, lastTime).evaluation).toHaveLength(1)
  })

  it('valida velas vacías, no ascendentes y duplicadas', () => {
    expect(() => splitCandles([], t0 + stepMs)).toThrow(SplitError)
    expect(() => splitCandles([...CANDLES].reverse(), t0 + stepMs)).toThrow(SplitError)
    expect(() => splitCandles([...CANDLES, CANDLES[0]!], t0 + stepMs)).toThrow(SplitError)
  })

  it('cutTime no finito → SplitError', () => {
    expect(() => splitCandles(CANDLES, Number.NaN)).toThrow(SplitError)
    expect(() => splitCandles(CANDLES, Number.POSITIVE_INFINITY)).toThrow(SplitError)
  })

  it('el error fija this.name', () => {
    try {
      splitCandles([], 0)
      expect.unreachable('debería lanzar SplitError')
    } catch (error) {
      expect((error as SplitError).name).toBe('SplitError')
    }
  })
})
