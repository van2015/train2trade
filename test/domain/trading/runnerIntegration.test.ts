import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { Constant } from '@/domain/indicators/constant'
import { Indicator } from '@/domain/indicators/indicator'
import { Sma } from '@/domain/indicators/sma'
import { series } from '@/domain/strategies/priceExpr'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskManager } from '@/domain/portfolio/riskManager'
import { ExecutionEvent, StrategyRunner } from '@/domain/trading/strategyRunner'

const t0 = 1_700_000_000_000
const step = 60_000

/**
 * Serie de precios (velas planas) que produce un cruce de SMA(2)/SMA(3):
 * - bajo en i3 (95 <= 96.67), - cruza AL ARRIBA en i4 (110 > 106.67) → entrada,
 * - y cruza ABAJO en i7 (115 < 120) → salida. Los calentamientos (null) no disparan.
 */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

const CANDLES = PRICES.map((price, index) =>
  Candle.from({
    time: t0 + index * step,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }),
)

interface E2EOptions {
  entryLimitPrice?: number
  veto?: () => boolean
}

function makeRunner(options: E2EOptions = {}) {
  const portfolio = new Portfolio(1_000)
  const model = new NextOpenExecutionModel({ slippageBps: 10, feeBps: 10 })
  const risk = new RiskManager({ slippageBps: 10, feeBps: 10 })
  const broker = new HistoricalBroker(portfolio, model)
  // Precio numérico del test → indicador constante (decisión 9).
  const indicators: Record<string, Indicator> = { fast: new Sma(2), slow: new Sma(3) }
  if (options.entryLimitPrice !== undefined) {
    indicators.entryPx = new Constant(options.entryLimitPrice)
  }
  const strategy = new Strategy({
    name: 'cross-e2e',
    indicators,
    signals: [
      new Signal(
        StrategyAction.RequestEntry,
        new CrossesAbove('fast', 'slow'),
        options.entryLimitPrice !== undefined ? { price: series('entryPx') } : {},
      ),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
    invalidationRule:
      options.veto !== undefined
        ? { name: 'session closed', evaluate: () => options.veto?.() ?? false }
        : undefined,
  })
  const runner = new StrategyRunner(strategy, broker, portfolio, risk)
  return { runner, portfolio, broker }
}

function visible(index: number): Candle[] {
  return CANDLES.slice(0, index + 1)
}

/** Escenario completo: alimenta las 9 velas y captura eventos + estado por vela. */
function runFullScenario() {
  const { runner, portfolio, broker } = makeRunner()
  const perCandle: ExecutionEvent[][] = []
  const positionAfter: (number | null)[] = []
  const cashAfter: number[] = []

  for (let index = 0; index < CANDLES.length; index += 1) {
    perCandle.push(runner.onCandle(visible(index)))
    positionAfter.push(portfolio.position?.qty ?? null)
    cashAfter.push(portfolio.cash)
  }

  return { runner, portfolio, broker, perCandle, positionAfter, cashAfter }
}

describe('Fase 3 E2E — ciclo de cruce de medias con comisiones y slippage', () => {
  it('eventos por vela: nada antes del cruce, entrada, salida y ciclos limpios', () => {
    const { perCandle } = runFullScenario()

    // i0-i2: calentamiento de indicadores → sin eventos
    expect(perCandle.slice(0, 3)).toEqual([[], [], []])
    // i3: cruce a la baja sin posición → no aplica (no hay nada que cerrar)
    expect(perCandle[3]).toEqual([])
    // i4: cruce al alza → confirmación + orden (mercado)
    expect(perCandle[4]).toEqual(['StrategyConfirmed', 'OrderSubmitted'])
    // i5: relleno en la apertura de la vela siguiente (sin look-ahead)
    expect(perCandle[5]).toEqual(['PositionOpened', 'OrderFilled'])
    // i6: sin señal
    expect(perCandle[6]).toEqual([])
    // i7: cruce a la baja → salida
    expect(perCandle[7]).toEqual(['ExitRequested', 'OrderSubmitted'])
    // i8: relleno de la salida
    expect(perCandle[8]).toEqual(['PositionClosed', 'OrderFilled'])
  })

  it('la orden de la vela N no rellena hasta la N+1 (anti look-ahead explícito)', () => {
    const { positionAfter, cashAfter } = runFullScenario()

    expect(positionAfter[4]).toBeNull() // decisión en i4: sin posición todavía
    expect(cashAfter[4]).toBe(1_000)
    expect(positionAfter[5]).not.toBeNull() // relleno en i5
    expect(positionAfter[7]).not.toBeNull() // decisión de salida: aún abierta
    expect(positionAfter[8]).toBeNull() // relleno en i8
  })

  it('tamaño, coste y P&L netos de comisiones y slippage', () => {
    const { portfolio, positionAfter } = runFullScenario()

    const unitCost = 130 * 1.001 * 1.001 // open con slippage + fee
    const expectedQty = 1_000 / unitCost
    expect(positionAfter[5]).toBeCloseTo(expectedQty, 6)
    expect(portfolio.position).toBeNull()

    // Entrada: coste unitario = 130 * 1.001 (slippage) * 1.001 (fee)
    const exitPrice = 100 * 0.999
    const expectedFees = expectedQty * (130 * 1.001 * 0.001 + 100 * 0.999 * 0.001)
    expect(portfolio.feesPaid).toBeCloseTo(expectedFees, 6)
    expect(portfolio.feesPaid).toBeGreaterThan(1)

    // Cierre total: cash = inicial + realizado (sin doble conteo) y pérdida neta real
    expect(portfolio.cash).toBeCloseTo(1_000 + portfolio.realizedPnl, 6)
    expect(portfolio.realizedPnl).toBeCloseTo(
      expectedQty * (exitPrice - unitCost - exitPrice * 0.001),
      6,
    )
    expect(portfolio.realizedPnl).toBeLessThan(0) // la serie cierra en pérdida
    expect(portfolio.cash).toBeCloseTo(expectedQty * exitPrice * 0.999, 6)
  })

  it('es determinista: dos ejecuciones idénticas producen los mismos eventos y cifras', () => {
    const first = runFullScenario()
    const second = runFullScenario()

    expect(second.perCandle).toEqual(first.perCandle)
    expect(second.cashAfter).toEqual(first.cashAfter)
    expect(second.positionAfter).toEqual(first.positionAfter)
    expect(second.portfolio.cash).toBe(first.portfolio.cash)
    expect(second.portfolio.realizedPnl).toBe(first.portfolio.realizedPnl)
  })
})

describe('Fase 3 E2E — veto con orden pendiente', () => {
  it('el veto retira la orden limit sin tocar el efectivo ni el ciclo', () => {
    let veto = false
    const { runner, portfolio, broker } = makeRunner({ entryLimitPrice: 100, veto: () => veto })

    const events: ExecutionEvent[][] = []
    for (let index = 0; index <= 4; index += 1) {
      events.push(runner.onCandle(visible(index)))
    }
    expect(events[4]).toEqual(['StrategyConfirmed', 'OrderSubmitted'])
    // limit 100 muy por debajo del mercado (130): sigue pendiente
    expect(broker.pendingOrders()).toHaveLength(1)

    veto = true
    events.push(runner.onCandle(visible(5)))

    expect(events[5]).toEqual(['OrderCancelled', 'EntryCancelled'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(broker.pendingOrders()).toEqual([])
    expect(portfolio.position).toBeNull()
    expect(portfolio.cash).toBe(1_000)
  })
})
