import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskManager } from '@/domain/portfolio/riskManager'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { StrategyAction } from '@/domain/strategies/strategy'
import { confirmationPoints } from '@/domain/testforward/confirmationPoints'
import { ExecutionEvent, StrategyRunner } from '@/domain/trading/strategyRunner'

const t0 = 1_700_000_000_000
const step = 60_000

/**
 * Serie sintética (velas planas: open = close) con dos V para la estrategia
 * objetivo del plan `rule-first-since-plan.md` §6: "primera vela que cierra
 * por encima de la EMA(15) a partir del mínimo de 100 velas".
 *
 * - 0..119   bajada lineal 200 → 81: `close < ema15` (la EMA se mantiene 7
 *            puntos por encima). `min100` calienta en la vela 99, así que las
 *            anclas visibles van de 99 a 119 (mínimo corriente) y la última
 *            es la 119.
 * - 120..149 meseta en 140 (salto desde 81): `close > ema15` en **todas** y
 *            sin nuevo mínimo ⇒ solo dispara la primera, la vela **120**.
 * - 150..160 caída 130 → 30: `close < ema15` (cruza a la baja en la 150 ⇒
 *            salida) y las velas 155..160 marcan el nuevo mínimo (< 81).
 * - 161..169 meseta en 150: `close > ema15` otra vez ⇒ nueva ancla (160) y
 *            segunda confirmación en la vela **161**.
 *
 * Las fases planas son adrede: el `qty` se dimensiona con el cierre de la vela
 * de decisión y el relleno ocurre en la apertura siguiente — si esa apertura
 * sube, el broker rechaza por "efectivo insuficiente" (comportamiento real del
 * sistema, cubierto en `historicalBroker.test.ts`).
 */
function closeAt(index: number): number {
  if (index <= 119) return 200 - index
  if (index <= 149) return 140
  if (index <= 160) return 140 - 10 * (index - 149)
  return 150
}

const TOTAL = 170

const CANDLES: Candle[] = Array.from({ length: TOTAL }, (_, index) => {
  const close = closeAt(index)
  return Candle.from({
    time: t0 + index * step,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  })
})

/** La spec exacta del plan §6 (más `exitRule` para que el runner cierre). */
const SPEC: StrategySpec = {
  name: 'rebound-ema15',
  version: 1,
  indicators: [
    { alias: 'ema15', kind: 'ema', period: 15 },
    { alias: 'min100', kind: 'lowestLow', period: 100 },
  ],
  entry: {
    execution: 'market',
    rule: {
      kind: 'first_since',
      since: { kind: 'condition', op: '==', a: 'low', b: 'min100' },
      then: { kind: 'condition', op: '>', a: 'close', b: 'ema15' },
    },
  },
  exitRule: { kind: 'condition', op: 'crosses_below', a: 'close', b: 'ema15' },
}

/** Alimenta el runner con prefijos (mismo patrón que `tradingSession`). */
function runScenario(): ExecutionEvent[][] {
  const portfolio = new Portfolio(1_000)
  const model = new NextOpenExecutionModel({ slippageBps: 10, feeBps: 10 })
  const risk = new RiskManager({ slippageBps: 10, feeBps: 10 })
  const broker = new HistoricalBroker(portfolio, model)
  const runner = new StrategyRunner(buildStrategy(SPEC), broker, portfolio, risk)

  const perCandle: ExecutionEvent[][] = []
  for (let index = 0; index < CANDLES.length; index += 1) {
    perCandle.push(runner.onCandle(CANDLES.slice(0, index + 1)))
  }
  return perCandle
}

function candlesWith(perCandle: readonly ExecutionEvent[][], event: ExecutionEvent): number[] {
  return perCandle.flatMap((events, index) => (events.includes(event) ? [index] : []))
}

describe('E2E first_since — primera vela sobre la EMA(15) desde el mínimo de 100', () => {
  it('la spec del plan construye la estrategia (first_since + == + lowestLow)', () => {
    const strategy = buildStrategy(SPEC)

    expect(strategy.toString()).toBe('rebound-ema15@1')
    expect(strategy.signals.map((signal) => signal.action)).toEqual([
      StrategyAction.RequestEntry,
      StrategyAction.RequestExit,
    ])
    expect(strategy.signals[1]?.name).toBe('request_exit: close crossesBelow ema15')
  })

  it('solo confirma la primera vela tras cada ancla, no las demás sobre la EMA', () => {
    const strategy = buildStrategy(SPEC)

    // 120: primera vela tras el mínimo de la vela 119 (la meseta tiene 30
    // velas con `close > ema15` y solo confirma la primera).
    // 161: primera vela tras el nuevo mínimo de la vela 160.
    expect(confirmationPoints(strategy, CANDLES)).toEqual([120, 161])
  })

  it('anti look-ahead: con prefijos se obtienen los mismos puntos que en la serie completa', () => {
    const strategy = buildStrategy(SPEC)
    const full = confirmationPoints(strategy, CANDLES)

    expect(confirmationPoints(strategy, CANDLES.slice(0, 121))).toEqual(
      full.filter((index) => index < 121),
    )
    // Un corte previo a la segunda ancla no puede "adivinar" la vela 161.
    expect(confirmationPoints(strategy, CANDLES.slice(0, 161))).toEqual([120])
  })

  it('el runner entra una vez por ancla: entrada → salida → segunda entrada', () => {
    const perCandle = runScenario()

    expect(candlesWith(perCandle, 'StrategyConfirmed')).toEqual([120, 161])
    expect(candlesWith(perCandle, 'PositionOpened')).toEqual([121, 162])
    expect(candlesWith(perCandle, 'ExitRequested')).toEqual([150])
    expect(candlesWith(perCandle, 'PositionClosed')).toEqual([151])
    // Sin rechazos: los rellenos caben en el efectivo (fases planas).
    expect(candlesWith(perCandle, 'OrderRejected')).toEqual([])
  })

  it('la decisión es observable: reason = "request_entry: firstSince(…)"', () => {
    const strategy = buildStrategy(SPEC)
    const decision = strategy.evaluate(strategy.buildContext(CANDLES.slice(0, 121)), false)

    expect(decision.action).toBe(StrategyAction.RequestEntry)
    expect(decision.price).toBeNull() // market: sin precio en la decisión
    expect(decision.reason).toBe('request_entry: firstSince(low == min100, close > ema15)')
  })

  it('es determinista: dos corridas producen los mismos eventos', () => {
    expect(runScenario()).toEqual(runScenario())
  })
})
