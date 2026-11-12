import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { OrderSide, OrderType } from '@/domain/execution/order'
import { Sma } from '@/domain/indicators/sma'
import { MarketReplayEngine, ReplayError } from '@/domain/replay/replayEngine'
import { CrossesAbove, CrossesBelow, Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { TradingSessionConfig, TradingSessionError } from '@/domain/trading/tradingSession'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie del E2E de Fase 3: cruce al alza en i4 (entrada) y salida posterior. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

function candlesFrom(prices: readonly number[]): Candle[] {
  return prices.map((price, index) =>
    Candle.from({
      time: t0 + index * stepMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
    }),
  )
}

const CANDLES = candlesFrom(PRICES)

function crossStrategy(): Strategy {
  return new Strategy({
    name: 'cross-e2e',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/** Entrada que dispara una sola vez (para anti look-ahead, rechazos y reglas). */
function enterOnceStrategy(): Strategy {
  let fired = false
  const rule: Rule = {
    name: 'enter once',
    evaluate: () => {
      if (fired) return false
      fired = true
      return true
    },
  }
  return new Strategy({
    name: 'enter-once',
    signals: [new Signal(StrategyAction.RequestEntry, rule)],
  })
}

/** Entrada con limit lejano (no rellena) y veto que la cancela en la vela 1. */
function vetoStrategy(): Strategy {
  let evaluations = 0
  return new Strategy({
    name: 'veto-e2e',
    signals: [
      new Signal(
        StrategyAction.RequestEntry,
        { name: 'always', evaluate: () => true },
        {
          limitPrice: 50,
        },
      ),
    ],
    invalidationRule: {
      name: 'veto-from-second',
      evaluate: () => {
        evaluations += 1
        return evaluations >= 2
      },
    },
  })
}

function baseConfig(overrides: Partial<TradingSessionConfig> = {}): TradingSessionConfig {
  return {
    strategy: crossStrategy(),
    candles: CANDLES,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}

function openEngine(overrides: Partial<TradingSessionConfig> = {}): MarketReplayEngine {
  return new MarketReplayEngine(baseConfig(overrides))
}

function runToEnd(engine: MarketReplayEngine): void {
  while (engine.status !== 'finished') engine.step()
}

/** Mismo formato que el dominio (8 decimales, sin ceros sobrantes). */
function formatAmount(value: number): string {
  return String(Number(value.toFixed(8)))
}

describe('MarketReplayEngine — construcción y máquina de estados', () => {
  it('config inválida propaga TradingSessionError (validación compartida)', () => {
    expect(() => new MarketReplayEngine(baseConfig({ candles: [] }))).toThrow(TradingSessionError)
  })

  it('arranca en ready con cursor 0 y log vacío', () => {
    const engine = openEngine()
    expect(engine.status).toBe('ready')
    expect(engine.cursor).toBe(0)
    expect(engine.log).toEqual([])
  })

  it('play → playing y pause → ready', () => {
    const engine = openEngine()
    engine.play()
    expect(engine.status).toBe('playing')
    engine.pause()
    expect(engine.status).toBe('ready')
  })

  it('transiciones inválidas → ReplayError (pause en ready, play repetido)', () => {
    const engine = openEngine()
    expect(() => engine.pause()).toThrow(ReplayError)
    engine.play()
    expect(() => engine.play()).toThrow(ReplayError)
    engine.pause()
    expect(() => engine.pause()).toThrow(ReplayError)
  })

  it('step hasta terminar → finished; step/play/pause en finished → ReplayError', () => {
    const engine = openEngine()
    runToEnd(engine)

    expect(engine.status).toBe('finished')
    expect(engine.cursor).toBe(CANDLES.length)
    expect(() => engine.step()).toThrow(ReplayError)
    expect(() => engine.play()).toThrow(ReplayError)
    expect(() => engine.pause()).toThrow(ReplayError)
  })

  it('reset → ready, cursor 0, log vacío y recorrido idéntico (§12C)', () => {
    const engine = openEngine()
    runToEnd(engine)
    const firstLog = engine.log
    const firstTrades = engine.session.broker.trades
    expect(firstLog.length).toBeGreaterThan(0)
    expect(firstTrades.length).toBeGreaterThan(0)

    engine.reset()
    expect(engine.status).toBe('ready')
    expect(engine.cursor).toBe(0)
    expect(engine.log).toEqual([])

    runToEnd(engine)
    expect(engine.log).toEqual(firstLog)
    expect(engine.session.broker.trades).toEqual(firstTrades)
  })

  it('reset desde playing vuelve a ready', () => {
    const engine = openEngine()
    engine.play()
    engine.reset()
    expect(engine.status).toBe('ready')
    expect(engine.cursor).toBe(0)
  })
})

describe('MarketReplayEngine — paso y log', () => {
  it('step devuelve índice, tiempo, estado, eventos y las entradas nuevas del log', () => {
    const engine = openEngine({
      strategy: enterOnceStrategy(),
      candles: candlesFrom([100, 100, 100]),
    })

    const first = engine.step()
    expect(first.index).toBe(0)
    expect(first.time).toBe(t0)
    expect(first.status).toBe('ready') // un paso manual no inicia la reproducción
    expect(first.events).toEqual(['StrategyConfirmed', 'OrderSubmitted'])
    expect(first.log).toEqual([
      { time: t0, kind: 'strategy', text: 'StrategyConfirmed' },
      { time: t0, kind: 'order', text: 'Orden enviada: comprar 10 (o1)', orderId: 'o1' },
    ])
  })

  it('el log acumulado es la unión de los logs de cada paso', () => {
    const engine = openEngine()
    const collected = []
    while (engine.status !== 'finished') {
      collected.push(...engine.step().log)
    }
    expect(engine.log).toEqual(collected)
    expect(engine.log.length).toBeGreaterThan(0)
  })

  it('los rellenos se registran con precio y cantidad', () => {
    const engine = openEngine({
      strategy: enterOnceStrategy(),
      candles: candlesFrom([100, 100, 100]),
    })
    engine.step() // o1 enviada (decidida en i0)
    expect(engine.session.broker.fills).toEqual([])

    const second = engine.step() // rellena en la apertura de i1
    expect(second.log).toEqual([
      { time: t0 + stepMs, kind: 'strategy', text: 'PositionOpened' },
      {
        time: t0 + stepMs,
        kind: 'fill',
        text: `Compra rellenada: ${formatAmount(10)} @ 100 (o1)`,
        orderId: 'o1',
      },
    ])
  })

  it('los rechazos del broker se registran con el motivo (una sola vez)', () => {
    // precio decide en i0 @100 (qty 10) pero abre en i1 @1000 → coste 10 000 > cash 1 000
    const engine = openEngine({
      strategy: enterOnceStrategy(),
      candles: candlesFrom([100, 1000, 1000]),
    })
    engine.step()

    const second = engine.step()
    expect(second.events).toContain('OrderRejected')
    expect(second.log).toEqual([
      {
        time: t0 + stepMs,
        kind: 'rejection',
        text: 'Orden rechazada (o1): efectivo insuficiente',
        orderId: 'o1',
      },
    ])
    expect(engine.log.filter((entry) => entry.kind === 'rejection')).toHaveLength(1)
  })

  it('las cancelaciones por veto se registran en el log', () => {
    const engine = openEngine({ strategy: vetoStrategy(), candles: candlesFrom([100, 100, 100]) })
    engine.step()
    expect(engine.session.broker.pendingOrders()).toHaveLength(1)

    const second = engine.step() // veto → cancela la orden limit
    expect(second.events).toEqual(['OrderCancelled', 'EntryCancelled'])
    expect(second.log).toEqual([
      { time: t0 + stepMs, kind: 'order', text: 'Orden cancelada (o1)', orderId: 'o1' },
      { time: t0 + stepMs, kind: 'strategy', text: 'EntryCancelled' },
    ])
  })
})

describe('MarketReplayEngine — operaciones manuales', () => {
  it('manualBuy envía una orden market pendiente que rellena en la siguiente vela', () => {
    const engine = openEngine()

    const order = engine.manualBuy(0.5)
    expect(order?.id).toBe('m1')
    expect(order?.side).toBe(OrderSide.Buy)
    expect(order?.type).toBe(OrderType.Market)
    expect(order?.qty).toBeCloseTo(5, 10) // 50% de 1 000 @ 100
    expect(order?.createdAt).toBe(t0) // antes del primer paso: primera vela
    expect(engine.session.broker.pendingOrders()).toHaveLength(1)
    expect(engine.cursor).toBe(0) // anti look-ahead: aún no avanza nada

    const first = engine.step()
    expect(engine.session.portfolio.position?.qty).toBeCloseTo(5, 10)
    expect(first.log).toEqual([
      { time: t0, kind: 'manual', text: 'Orden manual enviada: comprar 5 (m1)', orderId: 'm1' },
      { time: t0, kind: 'manual', text: 'Compra manual rellenada: 5 @ 100 (m1)', orderId: 'm1' },
    ])
  })

  it('manualBuy devuelve null cuando el riesgo no admite la operación', () => {
    const engine = openEngine()
    expect(engine.manualBuy(1)).not.toBeNull()
    engine.step() // invierte el equity completo: sin holgura de exposición
    expect(engine.manualBuy(0.1)).toBeNull()
    expect(engine.session.broker.pendingOrders()).toHaveLength(0)
  })

  it('manualSell: null sin posición, cierra total o parcial según la fracción', () => {
    const engine = openEngine()
    expect(engine.manualSell(1)).toBeNull() // sin posición

    engine.manualBuy(1)
    engine.step() // posición: 10 @ 100

    const partial = engine.manualSell(0.5)
    expect(partial?.side).toBe(OrderSide.Sell)
    expect(partial?.qty).toBeCloseTo(5, 10)
    engine.step()
    expect(engine.session.portfolio.position?.qty).toBeCloseTo(5, 10)

    const rest = engine.manualSell(1)
    expect(rest?.qty).toBeCloseTo(5, 10)
    engine.step()
    expect(engine.session.portfolio.position).toBeNull()
  })

  it('fracciones inválidas → ReplayError (compra y venta)', () => {
    const engine = openEngine()
    for (const fraction of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => engine.manualBuy(fraction)).toThrow(ReplayError)
      expect(() => engine.manualSell(fraction)).toThrow(ReplayError)
    }
  })

  it('regla de orden única en vuelo: con cualquier orden pendiente, los manuales fallan', () => {
    const engine = openEngine({
      strategy: enterOnceStrategy(),
      candles: candlesFrom([100, 100, 100]),
    })

    engine.step() // o1 (estrategia) pendiente
    expect(engine.session.broker.pendingOrders()).toHaveLength(1)
    expect(() => engine.manualBuy(0.5)).toThrow(ReplayError)
    expect(() => engine.manualSell(0.5)).toThrow(ReplayError)

    engine.step() // o1 rellena en i1 → sin pendientes
    expect(engine.session.broker.pendingOrders()).toHaveLength(0)
    const sell = engine.manualSell(0.5)
    expect(sell?.side).toBe(OrderSide.Sell)
    expect(sell?.qty).toBeCloseTo(5, 10) // 50% de la posición (10)
    expect(() => engine.manualBuy(0.25)).toThrow(ReplayError) // la venta manual está en vuelo
    expect(() => engine.manualSell(0.25)).toThrow(ReplayError)
  })

  it('manuales en finished → ReplayError', () => {
    const engine = openEngine()
    runToEnd(engine)
    expect(() => engine.manualBuy(0.5)).toThrow(ReplayError)
    expect(() => engine.manualSell(0.5)).toThrow(ReplayError)
  })

  it('el envío manual se registra al instante y viaja en el log del siguiente paso', () => {
    const engine = openEngine()

    engine.manualBuy(0.5)
    expect(engine.log).toEqual([
      { time: t0, kind: 'manual', text: 'Orden manual enviada: comprar 5 (m1)', orderId: 'm1' },
    ])

    const first = engine.step()
    expect(first.log[0]?.text).toBe('Orden manual enviada: comprar 5 (m1)')
    expect(first.log).toHaveLength(2) // envío (entre pasos) + relleno (en el paso)
  })

  it('un rechazo manual se registra con el motivo', () => {
    // decide @100 de la vela 0 pero la vela 1 abre en 1000 → coste 10 000 > cash 1 000
    const engine = openEngine({ candles: candlesFrom([100, 1000]) })
    engine.step()

    const order = engine.manualBuy(1)
    expect(order?.qty).toBeCloseTo(10, 10)

    const second = engine.step()
    expect(second.events).toEqual([]) // el runner no ve órdenes manuales: sin evento
    expect(second.log).toEqual([
      { time: t0, kind: 'manual', text: 'Orden manual enviada: comprar 10 (m1)', orderId: 'm1' },
      {
        time: t0 + stepMs,
        kind: 'manual',
        text: 'Orden manual rechazada (m1): efectivo insuficiente',
        orderId: 'm1',
      },
    ])
  })

  it('con manuales de por medio se mantiene Σ trades.pnl = realizedPnl (≤1 fill por vela)', () => {
    const engine = openEngine()
    engine.manualBuy(1)
    engine.step() // posición: 10 @ 100
    engine.manualSell(0.5)
    engine.step() // cierre parcial → trade 1
    engine.manualSell(1)
    engine.step() // cierre total → trade 2
    runToEnd(engine)

    const trades = engine.session.broker.trades
    expect(trades.length).toBeGreaterThanOrEqual(2)
    const total = trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(total).toBeCloseTo(engine.session.portfolio.realizedPnl, 10)
  })
})
