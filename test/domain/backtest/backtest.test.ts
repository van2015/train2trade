import { describe, expect, it } from 'vitest'
import { BacktestError, findConfigProblem, runBacktest } from '@/domain/backtest/backtest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow, Rule } from '@/domain/strategies/rules'
import { MarketContextError } from '@/domain/strategies/marketContext'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'

const t0 = 1_700_000_000_000
const step = 60_000

/** Serie del E2E de Fase 3: cruce al alza en i4 (entrada) y a la baja en i7 (salida). */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

function candlesFrom(prices: readonly number[]): Candle[] {
  return prices.map((price, index) =>
    Candle.from({
      time: t0 + index * step,
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

/** Estrategia que dispara una sola vez (para el test de anti look-ahead). */
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

describe('runBacktest — ciclo completo', () => {
  it('devuelve curva, trades, órdenes, eventos y métricas coherentes', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })

    // curva: un punto por cierre de vela
    expect(result.equityCurve).toHaveLength(CANDLES.length)
    expect(result.equityCurve.map((point) => point.time)).toEqual(CANDLES.map((c) => c.time))

    // eventos exactos (determinista, sin look-ahead)
    expect(result.events).toEqual([
      'StrategyConfirmed',
      'OrderSubmitted',
      'PositionOpened',
      'OrderFilled',
      'ExitRequested',
      'OrderSubmitted',
      'PositionClosed',
      'OrderFilled',
    ])

    // operaciones
    expect(result.orders).toHaveLength(2)
    expect(result.orders.every((order) => order.status === 'filled')).toBe(true)
    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade?.entryPrice).toBe(130)
    expect(trade?.exitPrice).toBe(100)
    expect(trade?.qty).toBeCloseTo(1_000 / 130, 6)
    expect(trade?.pnl).toBeCloseTo((100 - 130) * (1_000 / 130), 6)
    expect(trade?.win).toBe(false)

    // capital: compra en 130, venta en 100 → pérdida
    expect(result.finalEquity).toBeCloseTo((1_000 / 130) * 100, 6)
    expect(result.metrics.netProfit).toBeCloseTo(result.finalEquity - 1_000, 10)
    expect(result.metrics.roi).toBeLessThan(0)
    expect(result.metrics.winRate).toBe(0)
    expect(result.metrics.profitFactor).toBe(0)
    expect(result.metrics.maxDrawdown).toBeGreaterThan(0.2)
    expect(result.metrics.sharpe).not.toBeNull()
  })

  it('sin señales: curva plana, sin trades ni órdenes, métricas neutras', () => {
    const never: Strategy = new Strategy({
      name: 'never',
      signals: [new Signal(StrategyAction.RequestEntry, { name: 'no', evaluate: () => false })],
    })
    const result = runBacktest({
      strategy: never,
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })

    expect(result.trades).toEqual([])
    expect(result.orders).toEqual([])
    expect(result.events).toEqual([])
    expect(result.finalEquity).toBe(1_000)
    expect(result.equityCurve.every((point) => point.equity === 1_000)).toBe(true)
    expect(result.metrics.netProfit).toBe(0)
    expect(result.metrics.maxDrawdown).toBe(0)
    expect(result.metrics.winRate).toBeNull()
    expect(result.metrics.avgTrade).toBeNull()
    expect(result.metrics.expectancy).toBeNull()
    expect(result.metrics.profitFactor).toBeNull()
  })

  it('invariante: finalEquity = inicial + Σ pnl de los trades (posición cerrada)', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })
    const totalPnl = result.trades.reduce((sum, trade) => sum + trade.pnl, 0)
    expect(result.finalEquity).toBeCloseTo(1_000 + totalPnl, 6)
  })
})

describe('runBacktest — sin look-ahead', () => {
  it('la orden de la vela 0 se rellena después: equity intacto y eventos en orden', () => {
    const result = runBacktest({
      strategy: enterOnceStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })

    // decidida en la vela 0 → el equity de esa vela sigue intacto (sin posición)
    expect(result.equityCurve[0]?.equity).toBe(1_000)
    expect(result.events.indexOf('OrderSubmitted')).toBeLessThan(
      result.events.indexOf('PositionOpened'),
    )
    // sin salida configurada: posición abierta al final, marcada a mercado, sin trade
    expect(result.trades).toEqual([])
    expect(result.orders).toHaveLength(1)
    expect(result.finalEquity).toBeGreaterThan(0)
  })
})

describe('runBacktest — cierre opcional de posición (closePositionAtEnd, Fase 6)', () => {
  it('por defecto no cierra: sin trade de cierre ni orden extra', () => {
    const result = runBacktest({
      strategy: enterOnceStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })

    expect(result.trades).toEqual([]) // posición abierta al final, marcada a mercado
    expect(result.orders).toHaveLength(1)
    expect(result.finalEquity).toBeGreaterThan(0)
  })

  it('con true cierra al cierre de la última vela con los costes del modelo', () => {
    const result = runBacktest({
      strategy: enterOnceStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      execution: { feeBps: 10, slippageBps: 10 },
      closePositionAtEnd: true,
    })

    expect(result.trades).toHaveLength(1)
    const trade = result.trades[0]
    expect(trade?.exitTime).toBe(CANDLES[CANDLES.length - 1]?.time)
    expect(trade?.exitPrice).toBeCloseTo(99.9, 10) // venta con slippage 10 bps sobre 100
    expect(trade?.fees).toBeGreaterThan(0)

    expect(result.orders).toHaveLength(2)
    const closeOrder = result.orders[1]
    expect(closeOrder?.id).toBe('close')
    expect(closeOrder?.side).toBe('sell')
    expect(closeOrder?.status).toBe('filled')

    // Invariante de Fase 4 con la opción activa: Σ pnl = finalEquity − inicial.
    const total = result.trades.reduce((sum, item) => sum + item.pnl, 0)
    expect(result.finalEquity).toBeCloseTo(1_000 + total, 6)
    expect(result.finalEquity).toBeLessThan(1_000) // costes de entrada + cierre
    expect(result.equityCurve[result.equityCurve.length - 1]?.equity).toBeCloseTo(
      result.finalEquity,
      10,
    )
  })

  it('sin costes el cierre es exactamente al cierre de la última vela', () => {
    const result = runBacktest({
      strategy: enterOnceStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      closePositionAtEnd: true,
    })

    expect(result.trades[0]?.exitPrice).toBe(100)
    expect(result.trades[0]?.exitTime).toBe(CANDLES[CANDLES.length - 1]?.time)
  })

  it('con true y la estrategia ya cerrada no añade nada', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      closePositionAtEnd: true,
    })

    expect(result.trades).toHaveLength(1)
    expect(result.orders).toHaveLength(2)
    expect(result.orders.some((order) => order.id === 'close')).toBe(false)
  })
})

describe('runBacktest — determinismo y configuración (§12C)', () => {
  it('dos ejecuciones idénticas producen resultados idénticos', () => {
    const config = {
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      execution: { slippageBps: 10, feeBps: 10 },
      risk: { maxPositionFraction: 0.8 },
    }
    const first = runBacktest(config)
    const second = runBacktest({ ...config, strategy: crossStrategy() })
    expect(second).toEqual(first)
  })

  it('el modelo de ejecución afecta al resultado (fees ⇒ menor equity)', () => {
    const base = { strategy: crossStrategy(), candles: CANDLES, timeframe: Timeframe.HOUR }
    const plain = runBacktest({ ...base, initialCapital: 1_000 })
    const withFees = runBacktest({
      ...base,
      initialCapital: 1_000,
      execution: { feeBps: 100 }, // el risk estimado se deriva de aquí (fuente única)
    })
    expect(withFees.finalEquity).toBeLessThan(plain.finalEquity)
    expect(withFees.metrics.netProfit).toBeLessThan(plain.metrics.netProfit)
  })
})

describe('runBacktest — validación de la config', () => {
  it('rechaza velas vacías y timeframe inválido con BacktestError', () => {
    const base = { strategy: crossStrategy(), initialCapital: 1_000 }
    expect(() => runBacktest({ ...base, candles: [], timeframe: Timeframe.HOUR })).toThrow(
      BacktestError,
    )
    expect(() =>
      runBacktest({ ...base, candles: CANDLES, timeframe: '1h' as unknown as Timeframe }),
    ).toThrow(BacktestError)
  })

  it('rechaza capital inválido con BacktestError (validación compartida)', () => {
    const base = { strategy: crossStrategy(), candles: CANDLES, timeframe: Timeframe.HOUR }
    expect(() => runBacktest({ ...base, initialCapital: 0 })).toThrow(BacktestError)
    expect(() => runBacktest({ ...base, initialCapital: Number.NaN })).toThrow(BacktestError)
  })

  it('rechaza velas no ascendentes (el contexto del runner valida antes de mutar)', () => {
    const descending = [...CANDLES].reverse()
    expect(() =>
      runBacktest({
        strategy: crossStrategy(),
        candles: descending,
        timeframe: Timeframe.HOUR,
        initialCapital: 1_000,
      }),
    ).toThrow(MarketContextError)
  })
})

describe('findConfigProblem — validación compartida (fuente única)', () => {
  it('devuelve null con una config válida', () => {
    expect(
      findConfigProblem({
        strategy: crossStrategy(),
        candles: CANDLES,
        timeframe: Timeframe.HOUR,
        initialCapital: 1_000,
      }),
    ).toBeNull()
  })

  it.each([
    ['velas vacías', { candles: [] }, 'se necesita al menos una vela'],
    [
      'timeframe inválido',
      { timeframe: '1h' as unknown as Timeframe },
      'timeframe debe ser un Timeframe',
    ],
    ['capital inválido', { initialCapital: 0 }, 'initialCapital debe ser un número finito > 0'],
  ] as const)('describe %s sin lanzar', (_label, override, reason) => {
    const problem = findConfigProblem({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      ...override,
    })
    expect(problem?.reason).toBe(reason)
  })
})

describe('runBacktest — config efectiva en el resultado (§12C)', () => {
  it('registra execution/risk con los defaults ya resueltos', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
    })
    expect(result.execution).toEqual({ slippageBps: 0, feeBps: 0 })
    expect(result.risk).toEqual({
      maxPositionFraction: 1,
      minCashReserve: 0,
      feeBps: 0,
      slippageBps: 0,
    })
  })

  it('registra la config explícita pasada (parcial + defaults)', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      execution: { feeBps: 25 },
      risk: { maxPositionFraction: 0.5 },
    })
    expect(result.execution).toEqual({ slippageBps: 0, feeBps: 25 })
    expect(result.risk).toEqual({
      maxPositionFraction: 0.5,
      minCashReserve: 0,
      feeBps: 25, // derivado de execution: fuente única de costes
      slippageBps: 0,
    })
  })

  it('los costes del risk derivan de execution (fuente única, sin duplicar)', () => {
    const result = runBacktest({
      strategy: crossStrategy(),
      candles: CANDLES,
      timeframe: Timeframe.HOUR,
      initialCapital: 1_000,
      execution: { slippageBps: 10, feeBps: 30 },
    })
    // El risk estima exactamente los costes reales: no pueden divergir.
    expect(result.risk.feeBps).toBe(result.execution.feeBps)
    expect(result.risk.slippageBps).toBe(result.execution.slippageBps)
  })
})
