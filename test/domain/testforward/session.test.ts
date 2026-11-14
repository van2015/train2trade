import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { OrderStatus } from '@/domain/execution/order'
import { series } from '@/domain/strategies/priceExpr'
import { CrossesAbove, CrossesBelow, Greater } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { TradingSessionConfig } from '@/domain/trading/tradingSession'
import { TestForwardError, TestForwardSession } from '@/domain/testforward/session'

const t0 = 1_700_000_000_000
const stepMs = 60_000

/** Serie de los E2E: cruce SMA(2)/SMA(3) al alza en i4 y a la baja en i7. */
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

/** Cierre de `close > SMA(3)` en [4, 5] (misma serie de los E2E). */
const ABOVE_PRICES = PRICES

/** Velas planas a partir de una serie de cierres (open = high = low = close). */
function flat(closes: number[]): Candle[] {
  return closes.map((close, index) =>
    Candle.from({
      time: t0 + index * stepMs,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    }),
  )
}

const CANDLES: Candle[] = flat(PRICES)

/** Entrada por cruce al alza + salida por cruce a la baja (fixture E2E). */
function crossStrategy(): Strategy {
  return new Strategy({
    name: 'cross',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 'fast')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

/** Real: la entrada es `close > fast` — dispara en i4 (130 > 110). */
function aboveStrategy(): Strategy {
  return new Strategy({
    name: 'above',
    indicators: { s: new Sma(3) },
    signals: [new Signal(StrategyAction.RequestEntry, new Greater('close', 's'))],
  })
}

/** Nunca dispara: para "sin candidatos → finished". */
function neverStrategy(): Strategy {
  return new Strategy({
    name: 'never',
    signals: [new Signal(StrategyAction.RequestEntry, new Greater('close', 'close'))],
  })
}

/** Entrada por cruce + TP sobre la SMA lenta (§2.1.5: se ejecuta solo). */
function tpStrategy(): Strategy {
  return new Strategy({
    name: 'tp',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
    takeProfit: { price: series('slow'), execution: 'market' },
  })
}

/** Entrada por cruce + SL sobre la SMA rápida (en i5 el toque `low <= fast` dispara). */
function slStrategy(): Strategy {
  return new Strategy({
    name: 'sl',
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
    stopLoss: { price: series('fast'), execution: 'market' },
  })
}

/**
 * Entrada `close > SMA(3)` con precio `limit` = SMA + veto `close cruza por
 * debajo de SMA`: la entrada pausa en i4, la orden límite (115) no toca i5
 * (119) y el veto la retira.
 */
function vetoStrategy(): Strategy {
  return new Strategy({
    name: 'veto-take',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's'), {
        price: series('s'),
      }),
    ],
    invalidationRule: new CrossesBelow('close', 's'),
  })
}

const VETO_CANDLES = flat([100, 110, 105, 100, 140, 119])

/**
 * Entrada `close > SMA(3)` en [4, 7] y salida `close cruza bajo SMA` en i6:
 * un jump con destino i7 debe pausar en la salida de i6.
 */
const JUMP_CANDLES = flat([100, 110, 105, 100, 140, 120, 100, 130])

function jumpStrategy(): Strategy {
  return new Strategy({
    name: 'jump',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('close', 's')),
    ],
  })
}

function config(strategy: Strategy, candles: Candle[] = CANDLES): TradingSessionConfig {
  return { strategy, candles, timeframe: Timeframe.HOUR, initialCapital: 1_000 }
}

describe('TestForwardSession — start, RNG y confirmaciones (§2.1)', () => {
  it('start salta al primer punto aleatorio y pausa en la confirmación de entrada', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)

    expect(tf.points).toEqual([4])
    tf.start()

    expect(tf.status).toBe('awaiting')
    expect(tf.cursor).toBe(5) // procesó i0..i4
    expect(tf.confirmation?.kind).toBe('entry')
    expect(tf.confirmation?.decision.reason).toContain('request_entry')
    expect(tf.log.some((entry) => entry.kind === 'confirmation')).toBe(true)
  })

  it('el RNG inyectado elige el destino: salta al segundo candidato (el primero se descarta)', () => {
    const tf = new TestForwardSession(config(aboveStrategy()), () => 1) // candidates [4, 5] → 5

    expect(tf.points).toEqual([4, 5])
    tf.start()

    expect(tf.cursor).toBe(6) // pasó por i4 sin pausar (destino i5)
    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('entry')
  })

  it('decide(false) descarta la entrada: sin orden, sin posición', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)
    tf.start()
    tf.decide(false)

    expect(tf.status).toBe('idle')
    expect(tf.confirmation).toBeNull()
    expect(tf.session.broker.orders).toHaveLength(0)
    expect(tf.session.portfolio.position).toBeNull()
    expect(tf.log.some((entry) => entry.text.includes('descartada'))).toBe(true)
  })
})

describe('TestForwardSession — tomar (anti look-ahead §2.1)', () => {
  it('la orden aceptada rellena en la apertura de la vela siguiente a la decisión', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)
    tf.start() // pausa en i4 (cierre 130)
    tf.decide(true)

    expect(tf.status).toBe('idle')
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForEntryFill)
    expect(tf.session.broker.pendingOrders()).toHaveLength(1)
    expect(tf.log.some((entry) => entry.kind === 'order')).toBe(true)

    tf.step() // procesa i5 → relleno en su apertura

    const position = tf.session.portfolio.position
    expect(position?.isOpen).toBe(true)
    expect(position?.openedAt).toBe(CANDLES[5]?.time) // N+1: anti look-ahead
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForExitSignal)
    expect(tf.log.some((entry) => entry.text.includes('PositionOpened'))).toBe(true)
    expect(tf.log.some((entry) => entry.kind === 'fill')).toBe(true)
  })

  it('una entrada limit sin tocar y un veto posterior retiran la orden aceptada', () => {
    const tf = new TestForwardSession(config(vetoStrategy(), VETO_CANDLES), () => 0)
    tf.start() // confirma en i4; veto aún no dispara
    tf.decide(true) // limit @ SMA(i4) = 115

    expect(tf.session.instance.state).toBe(StrategyState.WaitingForEntryFill)
    tf.step() // i5 (119): la orden no toca el límite y el veto dispara

    expect(tf.session.broker.orders[0]?.status).toBe(OrderStatus.Cancelled)
    expect(tf.session.portfolio.position).toBeNull()
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(tf.status).toBe('finished') // i5 fue la última vela
    expect(tf.log.some((entry) => entry.text.includes('veto'))).toBe(true)
  })
})

describe('TestForwardSession — salida por regla con decisión (§2.1)', () => {
  it('la sesión pausa en la salida y decide() cierra o mantiene', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)
    tf.start()
    tf.decide(true)
    tf.step() // relleno de la entrada en i5

    tf.jump() // sin candidatos → corre hasta la salida de i7

    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('exit')
    expect(tf.cursor).toBe(8)

    tf.decide(true) // cerrar
    expect(tf.status).toBe('idle')
    expect(tf.log.some((entry) => entry.text.includes('Salida ejecutada'))).toBe(true)

    tf.step() // relleno de la venta en la apertura de i8
    expect(tf.session.portfolio.position?.isOpen ?? false).toBe(false)
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForSignal)
    expect(tf.session.broker.trades).toHaveLength(1)
    expect(tf.status).toBe('finished') // última vela procesada
  })

  it('decide(false) mantiene la posición abierta', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)
    tf.start()
    tf.decide(true)
    tf.step()
    tf.jump() // pausa en la salida de i7
    tf.decide(false) // mantener

    expect(tf.status).toBe('idle')
    expect(tf.session.portfolio.position?.isOpen).toBe(true)
    expect(tf.session.broker.trades).toHaveLength(0)
    expect(tf.log.some((entry) => entry.text.includes('mantenida'))).toBe(true)
  })
})

describe('TestForwardSession — TP/SL automáticos y overrides (§2.1.5)', () => {
  it('TP automático: se ejecuta solo, sin pausa', () => {
    const tf = new TestForwardSession(config(tpStrategy()), () => 0)
    tf.start()
    tf.decide(true)
    tf.step() // i5: relleno de entrada + TP tocado (high >= slow)

    expect(tf.status).toBe('idle') // sin confirmación: el TP manda solo
    expect(tf.session.broker.pendingOrders()).toHaveLength(1) // salida en vuelo

    tf.step() // i6: relleno de la venta
    expect(tf.session.broker.trades).toHaveLength(1)
    expect(tf.session.portfolio.position?.isOpen ?? false).toBe(false)
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForSignal)
  })

  it('el override manual sustituye a la expresión de la estrategia', () => {
    const tf = new TestForwardSession(config(tpStrategy()), () => 0)
    tf.setTakeProfit(200, true) // por encima del alto de i5 (130)
    tf.start()
    tf.decide(true)
    tf.step()

    // La expresión (slow ≈ 116.67) sí tocaría, pero manda el override.
    expect(tf.session.broker.pendingOrders()).toHaveLength(0)
    expect(tf.session.broker.trades).toHaveLength(0)
    expect(tf.session.portfolio.position?.isOpen).toBe(true)
  })

  it('desactivar el TP lo apaga y revertir a auto lo reactiva', () => {
    const off = new TestForwardSession(config(tpStrategy()), () => 0)
    off.setTakeProfit(null, false)
    off.start()
    off.decide(true)
    off.step()

    expect(off.session.broker.pendingOrders()).toHaveLength(0)
    expect(off.session.broker.trades).toHaveLength(0)

    const auto = new TestForwardSession(config(tpStrategy()), () => 0)
    auto.setTakeProfit(null, false)
    auto.setTakeProfit(null, true) // revertir a automático
    auto.start()
    auto.decide(true)
    auto.step()

    expect(auto.session.broker.pendingOrders()).toHaveLength(1)
  })

  it('SL automático: override manual lo sustituye y desactivarlo lo apaga', () => {
    const manual = new TestForwardSession(config(slStrategy()), () => 0)
    manual.setStopLoss(50, true) // el bajo de i5 (130) no lo toca
    manual.start()
    manual.decide(true)
    manual.step()

    expect(manual.session.broker.pendingOrders()).toHaveLength(0)
    expect(manual.session.broker.trades).toHaveLength(0)

    const off = new TestForwardSession(config(slStrategy()), () => 0)
    off.setStopLoss(null, false)
    off.start()
    off.decide(true)
    off.step()

    expect(off.session.broker.pendingOrders()).toHaveLength(0)

    const auto = new TestForwardSession(config(slStrategy()), () => 0)
    auto.start()
    auto.decide(true)
    auto.step() // low i5 (130) <= fast (130) → SL solo

    expect(auto.session.broker.pendingOrders()).toHaveLength(1)
    expect(auto.session.broker.trades).toHaveLength(0) // la venta aún no rellenó
  })
})

describe('TestForwardSession — jump, finish y errores (§2.2)', () => {
  it('sin candidatos, start corre hasta el final y termina', () => {
    const tf = new TestForwardSession(config(neverStrategy()), () => 0)

    expect(tf.points).toEqual([])
    tf.start()

    expect(tf.status).toBe('finished')
    expect(tf.cursor).toBe(CANDLES.length)
    expect(tf.confirmation).toBeNull()
  })

  it('jump pausa en la salida que aparece antes del destino y sigue hasta finished', () => {
    const tf = new TestForwardSession(config(jumpStrategy(), JUMP_CANDLES), () => 0)
    tf.start() // confirma en i4 (punto 0)
    tf.decide(true)
    tf.step() // relleno en i5 → cursor 6

    expect(tf.points).toEqual([4, 7])
    tf.jump() // destino i7; la salida de i6 interrumpe

    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('exit')
    expect(tf.cursor).toBe(7)

    tf.decide(false) // mantener
    tf.jump() // destino i7 (sigue pendiente)

    expect(tf.status).toBe('finished') // i7 procesado y sin más candidatos
    expect(tf.cursor).toBe(JUMP_CANDLES.length)
  })

  it('transiciones inválidas → TestForwardError', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)

    expect(() => tf.decide(true)).toThrow(TestForwardError) // sin confirmación

    tf.start() // awaiting
    expect(() => tf.step()).toThrow(TestForwardError)
    expect(() => tf.jump()).toThrow(TestForwardError)
    expect(() => tf.start()).toThrow(TestForwardError)
    tf.decide(false)
    expect(() => tf.decide(false)).toThrow(TestForwardError) // ya no hay pausa

    const end = new TestForwardSession(config(neverStrategy()), () => 0)
    end.start()
    expect(end.status).toBe('finished')
    expect(() => end.step()).toThrow(TestForwardError)
    expect(() => end.jump()).toThrow(TestForwardError)
    expect(() => end.start()).toThrow(TestForwardError)
    expect(() => end.decide(true)).toThrow(TestForwardError)
  })
})

describe('TestForwardSession — reset (§12C)', () => {
  it('reset reconstruye el stack: cursor 0, log vacío y mismo recorrido con el mismo RNG', () => {
    const tf = new TestForwardSession(config(crossStrategy()), () => 0)
    tf.start()
    tf.decide(true)
    tf.step()
    expect(tf.cursor).toBe(6)
    expect(tf.session.portfolio.position?.isOpen).toBe(true)

    tf.reset()

    expect(tf.cursor).toBe(0)
    expect(tf.status).toBe('idle')
    expect(tf.log).toHaveLength(0)
    expect(tf.confirmation).toBeNull()
    expect(tf.session.portfolio.position).toBeNull()
    expect(tf.session.portfolio.equity(CANDLES[8]?.close ?? 0)).toBe(1_000)

    tf.start() // mismo RNG → mismo recorrido (§12C)
    expect(tf.status).toBe('awaiting')
    expect(tf.cursor).toBe(5)
    expect(tf.confirmation?.kind).toBe('entry')
  })
})
