import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow, Greater, Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { confirmationPoints } from '@/domain/testforward/confirmationPoints'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E: cruce SMA(2)/SMA(3) al alza en i4 y a la baja en i7. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES: Candle[] = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

/** Velas con open ≠ close: i3 es roja (veto) pero con cierre en tendencia. */
const MIXED: Candle[] = [
  { open: 100, close: 100 },
  { open: 100, close: 110 },
  { open: 110, close: 105 },
  { open: 125, close: 120 },
  { open: 120, close: 100 },
  { open: 100, close: 130 },
].map((row, index) =>
  Candle.from({
    time: t0 + index * stepMs,
    open: row.open,
    high: Math.max(row.open, row.close),
    low: Math.min(row.open, row.close),
    close: row.close,
    volume: 1,
  }),
)

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'cross',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

function closeAboveSma(veto?: Rule): Strategy {
  return new Strategy({
    name: 'above',
    indicators: { s: new Sma(3) },
    signals: [new Signal(StrategyAction.RequestEntry, new Greater('close', 's'))],
    invalidationRule: veto,
  })
}

describe('confirmationPoints — barrido estadoless (§2.2)', () => {
  it('cruce SMA(2)/SMA(3): solo el cruce al alza es punto de entrada', () => {
    expect(confirmationPoints(crossStrategy(), CANDLES)).toEqual([4])
  })

  it('regla que se repite → todas las velas donde dispara (tras el calentamiento)', () => {
    expect(confirmationPoints(closeAboveSma(), CANDLES)).toEqual([4, 5])
  })

  it('el veto excluye los puntos donde invalidation dispara (§2.2: entry.rule + veto)', () => {
    expect(confirmationPoints(closeAboveSma(new Greater('open', 'close')), MIXED)).toEqual([5])
  })

  it('la misma regla sin veto dispara también en la vela vetada', () => {
    // i3 cierra por encima de la SMA(3) pero es roja (open > close).
    expect(confirmationPoints(closeAboveSma(), MIXED)).toEqual([3, 5])
  })

  it('velas vacías → sin puntos', () => {
    expect(confirmationPoints(crossStrategy(), [])).toEqual([])
  })

  it('calentamiento: la regla no dispara mientras la media sea null', () => {
    const short = CANDLES.slice(0, 2) // SMA(3) sin datos
    expect(confirmationPoints(closeAboveSma(), short)).toEqual([])
  })
})
