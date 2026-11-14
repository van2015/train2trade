import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { ExecutionModel, NextOpenExecutionModel } from '@/domain/execution/executionModel'
import { Fill } from '@/domain/execution/fill'
import { HistoricalBroker } from '@/domain/execution/historicalBroker'
import { OrderSide, OrderStatus, OrderType } from '@/domain/execution/order'
import { Constant } from '@/domain/indicators/constant'
import { Indicator } from '@/domain/indicators/indicator'
import { MarketContextError } from '@/domain/strategies/marketContext'
import { series } from '@/domain/strategies/priceExpr'
import { Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { Portfolio } from '@/domain/portfolio/portfolio'
import { RiskConfig, RiskManager } from '@/domain/portfolio/riskManager'
import { MarketClockError } from '@/domain/time/marketClock'
import { StrategyRunner } from '@/domain/trading/strategyRunner'

const t0 = 1_700_000_000_000
const step = 60_000

interface Flags {
  entry: boolean
  add: boolean
  reduce: boolean
  exit: boolean
  veto: boolean
}

interface RunnerOptions {
  /** Si se indica, la señal de entrada declara este limitPrice (si no, es market). */
  entryLimitPrice?: number
  /** Si se indica, la señal de add declara este limitPrice (si no, es market). */
  addLimitPrice?: number
}

function candle(index: number, overrides: { open?: number; high?: number; low?: number } = {}) {
  const open = overrides.open ?? 100
  const high = overrides.high ?? open + 5
  const low = overrides.low ?? open - 5
  return Candle.from({ time: t0 + index * step, open, high, low, close: open, volume: 10 })
}

/** Velas por defecto (todas a 100). */
const C0 = candle(0)
const C1 = candle(1)
const C2 = candle(2)
const C3 = candle(3)
/** Velas caras (open 110) para el ciclo de salida. */
const EXPENSIVE_2 = candle(2, { open: 110 })
const EXPENSIVE_3 = candle(3, { open: 110 })

function rule(name: string, value: () => boolean): Rule {
  return { name, evaluate: value }
}

function makeStrategy(flags: Flags, options: RunnerOptions = {}): Strategy {
  // Los precios numéricos del test se declaran como indicadores constante
  // (decisión 9: los precios de una estrategia no son literales).
  const indicators: Record<string, Indicator> = {}
  if (options.entryLimitPrice !== undefined) {
    indicators.entryPx = new Constant(options.entryLimitPrice)
  }
  if (options.addLimitPrice !== undefined) {
    indicators.addPx = new Constant(options.addLimitPrice)
  }

  return new Strategy({
    name: 'runner-test',
    indicators,
    signals: [
      new Signal(
        StrategyAction.RequestEntry,
        rule('entry?', () => flags.entry),
        options.entryLimitPrice !== undefined ? { price: series('entryPx') } : {},
      ),
      new Signal(
        StrategyAction.RequestAdd,
        rule('add?', () => flags.add),
        options.addLimitPrice !== undefined
          ? { fraction: 0.5, price: series('addPx') }
          : { fraction: 0.5 },
      ),
      new Signal(
        StrategyAction.RequestReduce,
        rule('reduce?', () => flags.reduce),
        { fraction: 0.5 },
      ),
      new Signal(
        StrategyAction.RequestExit,
        rule('exit?', () => flags.exit),
      ),
    ],
    invalidationRule: rule('veto?', () => flags.veto),
  })
}

function setup(
  riskConfig?: RiskConfig,
  model?: ExecutionModel,
  options: RunnerOptions = {},
  portfolio = new Portfolio(1_000),
) {
  const flags: Flags = { entry: false, add: false, reduce: false, exit: false, veto: false }
  const strategy = makeStrategy(flags, options)
  const risk = new RiskManager(riskConfig)
  const broker = new HistoricalBroker(portfolio, model ?? new NextOpenExecutionModel())
  const runner = new StrategyRunner(strategy, broker, portfolio, risk)
  return { flags, strategy, portfolio, risk, broker, runner }
}

describe('StrategyRunner — construcción y validación', () => {
  it('arranca sin posición ni órdenes y sin señal no emite nada', () => {
    const { runner, strategy, portfolio, broker } = setup()
    expect(runner.strategy).toBe(strategy)
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(runner.onCandle([C0])).toEqual([])
    expect(broker.pendingOrders()).toEqual([])
    expect(portfolio.cash).toBe(1_000)
  })

  it('lanza MarketContextError con velas vacías', () => {
    const { runner } = setup()
    expect(() => runner.onCandle([])).toThrow(MarketContextError)
  })

  it('exige velas estrictamente ascendentes entre llamadas (replay determinista)', () => {
    const { runner } = setup()
    runner.onCandle([C0])
    expect(runner.clock.now).toBe(C0.time) // el reloj avanza con cada vela aceptada
    expect(() => runner.onCandle([C0])).toThrow(MarketClockError) // tiempo no progresa
    expect(() => runner.onCandle([candle(-1)])).toThrow(MarketClockError) // retroceso
    expect(runner.clock.now).toBe(C0.time) // una llamada rechazada no avanza el reloj
  })
})

describe('StrategyRunner — entrada (sin look-ahead)', () => {
  it('la orden se decide al cierre de la vela y solo rellena en la siguiente', () => {
    const { flags, runner, portfolio, broker } = setup()
    flags.entry = true

    const events = runner.onCandle([C0])
    expect(events).toEqual(['StrategyConfirmed', 'OrderSubmitted'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForEntryFill)
    expect(broker.pendingOrders()).toHaveLength(1)
    expect(broker.pendingOrders()[0]?.type).toBe(OrderType.Market)
    expect(portfolio.position).toBeNull() // no rellena en la vela de la decisión
    expect(portfolio.cash).toBe(1_000)

    flags.entry = false
    const fillEvents = runner.onCandle([C0, C1])
    expect(fillEvents).toEqual(['PositionOpened', 'OrderFilled'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForExitSignal)
    expect(portfolio.position?.qty).toBeCloseTo(10, 10) // 1000 / 100
    expect(portfolio.cash).toBe(0)
    expect(broker.pendingOrders()).toEqual([])
  })

  it('el tamaño respeta maxPositionFraction', () => {
    const { flags, runner, portfolio } = setup({ maxPositionFraction: 0.5 })
    flags.entry = true
    runner.onCandle([C0])
    flags.entry = false
    runner.onCandle([C0, C1])
    expect(portfolio.position?.qty).toBeCloseTo(5, 10) // 500 / 100
    expect(portfolio.cash).toBeCloseTo(500, 10)
  })

  it('una entrada limit se envía al precio declarado y rellena al tocar la vela', () => {
    const { flags, runner, portfolio, broker } = setup(undefined, undefined, {
      entryLimitPrice: 95,
    })
    flags.entry = true
    runner.onCandle([C0])
    expect(broker.pendingOrders()[0]?.type).toBe(OrderType.Limit)
    expect(broker.pendingOrders()[0]?.price).toBe(95)

    flags.entry = false
    runner.onCandle([C0, candle(1, { open: 96, high: 99, low: 94 })])
    expect(portfolio.position?.avgEntryPrice).toBeCloseTo(95, 10)
  })

  it('si el riesgo no admite la entrada no se confirma ni se envía', () => {
    // reserva del 90% con efectivo casi agotado → entryQty devuelve null
    const portfolio = new Portfolio(1_000)
    portfolio.applyFill(
      new Fill({
        orderId: 'drain',
        side: OrderSide.Buy,
        price: 100,
        qty: 9,
        fee: 0,
        time: t0 - step,
      }),
    )
    const { flags, runner, broker } = setup({ minCashReserve: 0.9 }, undefined, {}, portfolio)

    flags.entry = true
    expect(runner.onCandle([C0])).toEqual([])
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(broker.pendingOrders()).toEqual([])
  })

  it('no duplica la orden pendiente si la señal de entrada sigue viva', () => {
    const { flags, runner, broker } = setup(undefined, undefined, { entryLimitPrice: 95 })
    flags.entry = true
    runner.onCandle([C0])
    // la vela siguiente no toca el límite: la orden sigue pendiente
    expect(runner.onCandle([C0, candle(1, { low: 96 })])).toEqual([])
    expect(broker.pendingOrders()).toHaveLength(1)
    expect(runner.instance.state).toBe(StrategyState.WaitingForEntryFill)
  })
})

describe('StrategyRunner — veto (invalidación)', () => {
  it('cancela la orden de entrada pendiente y retira la instancia', () => {
    const { flags, runner, portfolio, broker } = setup(undefined, undefined, {
      entryLimitPrice: 95,
    })
    flags.entry = true
    runner.onCandle([C0])

    flags.veto = true
    const events = runner.onCandle([C0, candle(1, { low: 96 })])
    expect(events).toEqual(['OrderCancelled', 'EntryCancelled'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(broker.pendingOrders()).toEqual([])
    expect(portfolio.position).toBeNull()
    expect(portfolio.cash).toBe(1_000)
  })

  it('el veto sin orden pendiente es un no-op', () => {
    const { flags, runner } = setup()
    flags.veto = true
    expect(runner.onCandle([C0])).toEqual([])
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
  })
})

describe('StrategyRunner — ciclo completo', () => {
  it('entrada → salida: eventos, estados y P&L correctos', () => {
    const { flags, runner, portfolio } = setup()
    flags.entry = true
    runner.onCandle([C0])
    flags.entry = false

    runner.onCandle([C0, C1]) // fill: 10 @ 100, cash 0
    flags.exit = true
    const exitEvents = runner.onCandle([C0, C1, EXPENSIVE_2])
    expect(exitEvents).toEqual(['ExitRequested', 'OrderSubmitted'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForExitFill)

    flags.exit = false
    const closeEvents = runner.onCandle([C0, C1, EXPENSIVE_2, EXPENSIVE_3]) // sell al open (110)
    expect(closeEvents).toEqual(['PositionClosed', 'OrderFilled'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(portfolio.position).toBeNull()
    expect(portfolio.cash).toBe(1_100)
    expect(portfolio.realizedPnl).toBeCloseTo(100, 10)
  })
})

describe('StrategyRunner — Add y Reduce', () => {
  it('añade y reduce la posición sin mover el ciclo de la estrategia', () => {
    const { flags, runner, portfolio, broker } = setup({ maxPositionFraction: 0.5 })
    flags.entry = true
    runner.onCandle([C0])
    flags.entry = false
    runner.onCandle([C0, C1]) // posición 5 @ 100, cash 500 (en el tope del 50%)

    // La bajada a 90 libera holgura de exposición: headroom = 950*0.5 - 450 = 25,
    // presupuesto = 25 * 0.5 (fracción de la señal) = 12.5 → qty = 12.5/90
    const DROP_2 = candle(2, { open: 90 })
    const DROP_3 = candle(3, { open: 90 })
    const addQty = 12.5 / 90
    flags.add = true
    expect(runner.onCandle([C0, C1, DROP_2])).toEqual(['OrderSubmitted'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForExitSignal)
    expect(broker.pendingOrders()[0]?.side).toBe(OrderSide.Buy)

    flags.add = false
    expect(runner.onCandle([C0, C1, DROP_2, DROP_3])).toEqual(['OrderFilled'])
    expect(portfolio.position?.qty).toBeCloseTo(5 + addQty, 10)
    expect(portfolio.cash).toBeCloseTo(487.5, 8) // 500 - 12.5 (±redondeo de qty)

    // Reduce: fracción 0.5 de la posición abierta
    const DROP_4 = candle(4, { open: 90 })
    flags.reduce = true
    expect(runner.onCandle([C0, C1, DROP_2, DROP_3, DROP_4])).toEqual(['OrderSubmitted'])
    expect(broker.pendingOrders()[0]?.side).toBe(OrderSide.Sell)
    expect(broker.pendingOrders()[0]?.qty).toBeCloseTo((5 + addQty) / 2, 10)

    flags.reduce = false
    const DROP_5 = candle(5, { open: 90 })
    expect(runner.onCandle([C0, C1, DROP_2, DROP_3, DROP_4, DROP_5])).toEqual(['OrderFilled'])
    expect(portfolio.position?.qty).toBeCloseTo((5 + addQty) / 2, 10)
    expect(portfolio.cash).toBeCloseTo(718.75, 8)
    expect(runner.instance.state).toBe(StrategyState.WaitingForExitSignal)
  })

  it('no permite añadir si la subida supera el máximo de exposición', () => {
    const { flags, runner, broker } = setup({ maxPositionFraction: 0.5 })
    flags.entry = true
    runner.onCandle([C0])
    flags.entry = false
    runner.onCandle([C0, C1]) // 5 @ 100 = 50% (en el tope)

    flags.add = true
    // sube a 110: exposición 550 > 50% de equity (1050) → no es admisible
    expect(runner.onCandle([C0, C1, EXPENSIVE_2])).toEqual([])
    expect(broker.pendingOrders()).toEqual([])
  })

  it('la salida anula un ajuste pendiente (cerrar manda)', () => {
    // add limit lejano (50) para que siga en vuelo cuando llegue la salida
    const { flags, runner, broker } = setup({ maxPositionFraction: 0.5 }, undefined, {
      addLimitPrice: 50,
    })
    flags.entry = true
    runner.onCandle([C0])
    flags.entry = false
    runner.onCandle([C0, C1]) // abierta: 5 @ 100, cash 500

    flags.add = true
    runner.onCandle([C0, C1, C2])
    expect(broker.pendingOrders()).toHaveLength(1)
    expect(broker.pendingOrders()[0]?.type).toBe(OrderType.Limit)

    flags.add = false
    flags.exit = true
    const events = runner.onCandle([C0, C1, C2, C3])
    expect(events).toEqual(['OrderCancelled', 'ExitRequested', 'OrderSubmitted'])
    expect(runner.instance.state).toBe(StrategyState.WaitingForExitFill)
    expect(broker.pendingOrders()).toHaveLength(1)
    expect(broker.pendingOrders()[0]?.side).toBe(OrderSide.Sell)
  })
})

describe('StrategyRunner — rechazos del broker', () => {
  it('emite OrderRejected, mantiene el ciclo y reintenta en la misma vela', () => {
    // comisión del 100% en el modelo y 0 en riesgo → el coste real supera el cash
    const model = new NextOpenExecutionModel({ feeBps: 10_000 })
    const { flags, runner, portfolio, broker } = setup(undefined, model)
    flags.entry = true
    runner.onCandle([C0])

    // la orden se rechaza al avanzar y, con la señal viva, se vuelve a enviar
    expect(runner.onCandle([C0, C1])).toEqual(['OrderRejected', 'OrderSubmitted'])
    expect(portfolio.cash).toBe(1_000)
    expect(portfolio.position).toBeNull()
    expect(runner.instance.state).toBe(StrategyState.WaitingForEntryFill)
    expect(broker.pendingOrders()).toHaveLength(1)
  })
})

describe('StrategyRunner — contrato de dominio', () => {
  it('las órdenes usan ids deterministas y createdAt = tiempo de la vela de decisión', () => {
    const { flags, runner, broker } = setup()
    flags.entry = true
    runner.onCandle([C0])
    const order = broker.pendingOrders()[0]
    expect(order?.id).toBe('o1')
    expect(order?.createdAt).toBe(C0.time)
    expect(order?.status).toBe(OrderStatus.Pending)
  })
})
