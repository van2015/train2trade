import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Constant } from '@/domain/indicators/constant'
import { Sma } from '@/domain/indicators/sma'
import { OrderStatus } from '@/domain/execution/order'
import { series } from '@/domain/strategies/priceExpr'
import { CrossesAbove, CrossesBelow, Greater, Lower } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { TradingSessionConfig } from '@/domain/trading/tradingSession'
import { TestForwardError, TestForwardSession } from '@/domain/testforward/session'
import { crossStrategy, type CrossStrategyOptions } from '../../support/strategies'

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

/** Entrada `close > SMA(3)` con precio limit sobre la propia SMA (sin veto): puede quedarse en vuelo. */
function limitEntryStrategy(): Strategy {
  return new Strategy({
    name: 'limit-entry',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's'), { price: series('s') }),
    ],
  })
}

/** Entrada market + salida limit sobre la SMA con regla de estado (`close < s` sigue verdadera). */
function exitLimitStrategy(): Strategy {
  return new Strategy({
    name: 'exit-limit',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's')),
      new Signal(StrategyAction.RequestExit, new Lower('close', 's'), { price: series('s') }),
    ],
  })
}

/** Entrada + salida por regla de estado (market): ciclo completo y reentrada posterior. */
function roundTripStrategy(): Strategy {
  return new Strategy({
    name: 'round-trip',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's')),
      new Signal(StrategyAction.RequestExit, new Lower('close', 's')),
    ],
  })
}

/** Entrada + señal `add` (no es entry/exit): debe pasar sin confirmación. */
function addSignalStrategy(): Strategy {
  return new Strategy({
    name: 'with-add',
    indicators: { s: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 's')),
      new Signal(StrategyAction.RequestAdd, new Greater('close', 's'), { fraction: 0.5 }),
    ],
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

/** Regla de entrada verdadera en i4..i7 con el límite (115) siempre por debajo del mercado. */
const BLOCK_ENTRY_CANDLES = flat([100, 110, 105, 100, 140, 150, 160, 170])

/** Salida limit (120) nunca tocada con `close < s` verdadero en i7 e i8. */
const BLOCK_EXIT_CANDLES = flat([100, 110, 105, 100, 140, 130, 90, 85, 80])

/** El veto retira la entrada en i5 y la regla vuelve a disparar en i6. */
const VETO_REENTRY_CANDLES = flat([100, 110, 105, 100, 140, 119, 160, 170])

/** Ciclo completo: entrada (i4), salida (i6), cierre (i7) y reentrada (i8). */
const REENTRY_CANDLES = flat([100, 110, 105, 100, 140, 130, 90, 85, 150, 160, 170, 180])

/** Puntos [4, 6]: con posición abierta, i6 no confirma y jump no debe comerse el resto. */
const JUMP_STOP_CANDLES = flat([100, 110, 105, 100, 140, 120, 150, 100, 100])

/** Entrada rellena sin gap (i5 abre = cierre de i4) y `add` disparando con posición abierta. */
const ADD_CANDLES = flat([100, 110, 105, 100, 140, 140, 150])

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

/**
 * Entrada `close > SMA(2)`, TP limit (105) y salida limit (110): el TP se
 * resuelve **antes** que la salida en el mismo bucle de rellenos, así que la
 * orden de salida llega al broker sin posición y debe rechazarse.
 */
function tpAndExitStrategy(): Strategy {
  return new Strategy({
    name: 'tp-exit',
    indicators: { fast: new Sma(2), tpPx: new Constant(105), exitPx: new Constant(110) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new Greater('close', 'fast')),
      new Signal(StrategyAction.RequestExit, new Lower('close', 'tpPx'), {
        price: series('exitPx'),
      }),
    ],
    takeProfit: { price: series('tpPx'), execution: 'limit' },
  })
}

function config(strategy: Strategy, candles: Candle[] = CANDLES): TradingSessionConfig {
  return { strategy, candles, timeframe: Timeframe.HOUR, initialCapital: 1_000 }
}

/** Variante real: la entrada es `close > fast` (dispara en i4), no el cruce al alza. */
const CROSS: CrossStrategyOptions = { name: 'cross', entry: new Greater('close', 'fast') }

describe('TestForwardSession — start, RNG y confirmaciones (§2.1)', () => {
  it('start salta al primer punto aleatorio y pausa en la confirmación de entrada', () => {
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)

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
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)
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
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)
    tf.start() // pausa en i4 (cierre 130)
    tf.decide(true)

    expect(tf.status).toBe('idle')
    expect(tf.session.instance.state).toBe(StrategyState.WaitingForEntryFill)
    expect(tf.session.broker.pendingOrders()).toHaveLength(1)
    expect(tf.session.broker.orders[0]?.id).toBe('t1') // ids secuenciales t1, t2… (§12C)
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
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)
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
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)
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

  it('salida limit rechazada (el TP cerró antes) → "Orden no ejecutada" en el log', () => {
    const tf = new TestForwardSession(
      config(tpAndExitStrategy(), flat([100, 100, 100, 90, 130, 130, 100, 110])),
      () => 0,
    )
    tf.start() // pausa en i4 (entrada)
    tf.decide(true)
    tf.step() // i5: entrada rellena y el TP limit (105) se envía

    expect(tf.session.portfolio.position?.isOpen).toBe(true)

    tf.step() // i6: el TP no toca (100 < 105) y la señal de salida pausa

    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('exit')
    tf.decide(true) // salida limit (110) en vuelo

    tf.step() // i7 (110): el TP rellena → cierra; la salida se rechaza sin posición

    expect(tf.session.portfolio.position).toBeNull()
    expect(tf.log.some((entry) => entry.text.includes('Orden no ejecutada'))).toBe(true)
    expect(tf.log.some((entry) => entry.text.includes('sin posición abierta'))).toBe(true)
  })
})

describe('TestForwardSession — órdenes propias en vuelo (§2.1)', () => {
  it('entrada limit pendiente con la regla todavía verdadera → sin nueva confirmación', () => {
    const tf = new TestForwardSession(config(limitEntryStrategy(), BLOCK_ENTRY_CANDLES), () => 0)
    tf.start() // pausa en i4 (primera confirmación)
    expect(tf.status).toBe('awaiting')
    tf.decide(true) // limit @ s(i4) = 115; el mercado abre por encima → no rellena

    expect(tf.session.broker.pendingOrders()).toHaveLength(1)

    for (const index of [5, 6, 7]) {
      tf.step()
      expect(tf.status).toBe(index === 7 ? 'finished' : 'idle') // nunca re-pausa
      expect(tf.confirmation).toBeNull()
      expect(tf.session.broker.pendingOrders()).toHaveLength(1) // sigue en vuelo
      expect(tf.session.broker.orders).toHaveLength(1) // sin órdenes nuevas
    }
  })

  it('salida limit pendiente con la regla todavía verdadera → sin nueva confirmación', () => {
    const tf = new TestForwardSession(config(exitLimitStrategy(), BLOCK_EXIT_CANDLES), () => 0)
    tf.start() // pausa en i4
    tf.decide(true)
    tf.step() // i5: relleno de la entrada
    tf.step() // i6: la regla de salida dispara → pausa

    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('exit')
    tf.decide(true) // salida limit @ s(i6) = 120; abre por debajo → no rellena

    tf.step() // i7: `close < s` sigue verdadero pero la orden propia está en vuelo
    expect(tf.status).toBe('idle')
    expect(tf.confirmation).toBeNull()
    expect(tf.session.broker.pendingOrders()).toHaveLength(1)

    tf.step() // i8 (última)
    expect(tf.status).toBe('finished')
    expect(tf.confirmation).toBeNull()
    expect(tf.session.broker.pendingOrders()).toHaveLength(1)
    expect(tf.session.portfolio.position?.isOpen).toBe(true)
  })

  it('el veto retira la orden propia y la siguiente señal vuelve a confirmar', () => {
    const tf = new TestForwardSession(config(vetoStrategy(), VETO_REENTRY_CANDLES), () => 0)
    tf.start() // pausa en i4
    tf.decide(true) // limit @ 115
    tf.step() // i5: no rellena; el veto la retira y se libera el bloqueo

    expect(tf.session.broker.orders[0]?.status).toBe(OrderStatus.Cancelled)
    expect(tf.status).toBe('idle')

    tf.step() // i6: la regla vuelve a disparar con la orden ya resuelta
    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('entry')
    expect(tf.cursor).toBe(7)
  })

  it('tras cerrar la posición, la siguiente señal de entrada vuelve a confirmar', () => {
    const tf = new TestForwardSession(config(roundTripStrategy(), REENTRY_CANDLES), () => 0)
    tf.start() // pausa en i4
    tf.decide(true)
    tf.step() // i5: relleno de la entrada
    tf.step() // i6: la regla de salida dispara → pausa

    expect(tf.confirmation?.kind).toBe('exit')
    tf.decide(true) // cerrar (market)
    tf.step() // i7: relleno de la venta → posición cerrada y bloqueos liberados

    expect(tf.session.portfolio.position?.isOpen ?? false).toBe(false)
    expect(tf.status).toBe('idle')

    tf.step() // i8: la regla de entrada vuelve a disparar
    expect(tf.status).toBe('awaiting')
    expect(tf.confirmation?.kind).toBe('entry')
  })

  it('una señal que no es entry/exit pasa sin confirmación (no se convierte en salida)', () => {
    const tf = new TestForwardSession(config(addSignalStrategy(), ADD_CANDLES), () => 0)
    tf.start() // pausa en i4
    tf.decide(true)
    tf.step() // i5: relleno de la entrada + la señal `add` dispara con posición abierta

    expect(tf.session.portfolio.position?.isOpen).toBe(true) // la entrada sí rellenó
    expect(tf.status).toBe('idle')
    expect(tf.confirmation).toBeNull()
  })
})

describe('TestForwardSession — TP/SL automáticos y overrides (§2.1.5)', () => {
  it('setTakeProfit/setStopLoss con precio no finito → TestForwardError', () => {
    const tf = new TestForwardSession(config(tpStrategy()), () => 0)

    expect(() => tf.setTakeProfit(Number.NaN, true)).toThrow(
      'takeProfit: el precio debe ser un número finito',
    )
    expect(() => tf.setStopLoss(Number.POSITIVE_INFINITY, true)).toThrow(
      'stopLoss: el precio debe ser un número finito',
    )
    expect(() => tf.setStopLoss('50' as never, true)).toThrow(
      'stopLoss: el precio debe ser un número finito',
    )
  })

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

  it('la confirmación en la última vela: pausa sin pisar el estado y decide() la sincroniza', () => {
    const last = config(aboveStrategy(), flat([100, 100, 100, 100, 140])) // primer disparo en i4 (final)

    const paused = new TestForwardSession(last, () => 0)
    paused.start()
    expect(paused.status).toBe('awaiting') // el sync de fin no pisa la pausa

    const discarded = new TestForwardSession(last, () => 0)
    discarded.start()
    discarded.decide(false)
    expect(discarded.status).toBe('finished') // syncFinished tras decidir en la última vela

    const taken = new TestForwardSession(last, () => 0)
    taken.start()
    taken.decide(true)
    expect(taken.status).toBe('finished')
  })

  it('jump se detiene en el destino aunque la señal no confirme (sin comerse el resto)', () => {
    const tf = new TestForwardSession(config(aboveStrategy(), JUMP_STOP_CANDLES), () => 0)
    tf.start() // pausa en i4
    tf.decide(true)
    tf.step() // i5: relleno → la señal de entrada ya no confirma (posición abierta)

    expect(tf.points).toEqual([4, 6])
    tf.jump() // destino i6: la regla dispara pero con posición abierta no confirma

    expect(tf.status).toBe('idle') // no corre hasta el final
    expect(tf.cursor).toBe(7) // procesó hasta el destino (i6) y se detuvo
  })

  it('transiciones inválidas → TestForwardError', () => {
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)

    expect(() => tf.decide(true)).toThrow(TestForwardError) // sin confirmación
    expect(() => tf.decide(true)).toThrow('no hay confirmación pendiente que decidir')

    tf.start() // awaiting
    expect(() => tf.step()).toThrow(TestForwardError)
    expect(() => tf.step()).toThrow(
      'hay una confirmación pendiente: usa decide() antes de continuar (recibido: "awaiting")',
    )
    expect(() => tf.jump()).toThrow(TestForwardError)
    expect(() => tf.start()).toThrow(TestForwardError)
    tf.decide(false)
    expect(() => tf.decide(false)).toThrow(TestForwardError) // ya no hay pausa

    const end = new TestForwardSession(config(neverStrategy()), () => 0)
    end.start()
    expect(end.status).toBe('finished')
    expect(() => end.step()).toThrow(TestForwardError)
    expect(() => end.step()).toThrow(
      'la sesión ya terminó; reinicia para volver a empezar (recibido: "finished")',
    )
    expect(() => end.jump()).toThrow(TestForwardError)
    expect(() => end.start()).toThrow(TestForwardError)
    expect(() => end.decide(true)).toThrow(TestForwardError)
  })

  it('el error tiene name TestForwardError y el dominio en el mensaje', () => {
    try {
      new TestForwardSession(config(crossStrategy(CROSS)), () => 0).decide(true)
      throw new Error('debía lanzar TestForwardError')
    } catch (error) {
      expect(error).toBeInstanceOf(TestForwardError)
      expect((error as TestForwardError).name).toBe('TestForwardError')
      expect((error as TestForwardError).message).toContain('Sesión de test-forward inválida')
    }
  })
})

describe('TestForwardSession — reset (§12C)', () => {
  it('reset reconstruye el stack: cursor 0, log vacío y mismo recorrido con el mismo RNG', () => {
    const tf = new TestForwardSession(config(crossStrategy(CROSS)), () => 0)
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
