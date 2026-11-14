import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Constant } from '@/domain/indicators/constant'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { Rsi } from '@/domain/indicators/rsi'
import { Sma } from '@/domain/indicators/sma'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'
import { InvalidPriceExprError, plus, series } from '@/domain/strategies/priceExpr'
import { Greater, Rule } from '@/domain/strategies/rules'
import {
  InvalidStrategyDefinitionError,
  OrderExecution,
  Signal,
  SignalAction,
  Strategy,
  StrategyAction,
  StrategyDefinition,
  Trigger,
} from '@/domain/strategies/strategy'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

const context = MarketContext.from({ candles: CANDLES })

function contextWith(indicators: Record<string, (number | null)[]>): MarketContext {
  const series: Record<string, IndicatorValue[]> = {}
  for (const [id, values] of Object.entries(indicators)) {
    series[id] = CANDLES.map((candle, index) => ({
      time: candle.time,
      value: values[index] ?? null,
    }))
  }
  return MarketContext.from({ candles: CANDLES, indicators: series })
}

function rule(name: string, result: boolean): Rule {
  return { name, evaluate: () => result }
}

function strategyWith(signals: Signal[], overrides: Partial<StrategyDefinition> = {}): Strategy {
  return new Strategy({ name: 'test', signals, ...overrides })
}

describe('Signal', () => {
  it('name es "accion: rule.name" y con price añade "@ expr"', () => {
    expect(new Signal(StrategyAction.RequestEntry, rule('rsi > 30', true)).name).toBe(
      'request_entry: rsi > 30',
    )
    expect(
      new Signal(StrategyAction.RequestExit, rule('rsi > 70', true), { price: series('sma20') })
        .name,
    ).toBe('request_exit: rsi > 70 @ sma20')
  })

  it('RequestAdd/RequestReduce requieren fraction válida en (0, 1]', () => {
    for (const fraction of [undefined, 0, 1.5, -0.2, NaN]) {
      expect(() => new Signal(StrategyAction.RequestAdd, rule('a', true), { fraction })).toThrow(
        InvalidStrategyDefinitionError,
      )
      expect(() => new Signal(StrategyAction.RequestReduce, rule('a', true), { fraction })).toThrow(
        InvalidStrategyDefinitionError,
      )
    }
  })

  it('RequestEntry/RequestExit no aceptan fraction', () => {
    expect(
      () => new Signal(StrategyAction.RequestEntry, rule('a', true), { fraction: 0.5 }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(() => new Signal(StrategyAction.RequestExit, rule('a', true), { fraction: 1 })).toThrow(
      InvalidStrategyDefinitionError,
    )
  })

  it('price acepta expresiones; un literal numérico → InvalidPriceExprError', () => {
    expect(
      () => new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('sma20') }),
    ).not.toThrow()
    expect(
      () =>
        new Signal(StrategyAction.RequestEntry, rule('a', true), {
          price: plus('a', 'b'),
        }),
    ).not.toThrow()
    expect(
      () => new Signal(StrategyAction.RequestEntry, rule('a', true), { price: 99.5 as never }),
    ).toThrow(InvalidPriceExprError)
  })
})

describe('Strategy (construcción)', () => {
  it('almacena name, version (default 1), signals e indicators', () => {
    const signal = new Signal(StrategyAction.RequestEntry, rule('a', true))
    const rsi = new Rsi(2)
    const strategy = strategyWith([signal], { indicators: { rsi } })

    expect(strategy.name).toBe('test')
    expect(strategy.version).toBe(1)
    expect(strategy.signals).toEqual([signal])
    expect(strategy.signals[0]).toBe(signal)
    expect(strategy.indicators.rsi).toBe(rsi)
  })

  it('respeta la versión personalizada', () => {
    expect(
      strategyWith([new Signal(StrategyAction.RequestEntry, rule('a', true))], { version: 3 })
        .version,
    ).toBe(3)
  })

  it('name vacío → InvalidStrategyDefinitionError', () => {
    expect(
      () =>
        new Strategy({
          name: '',
          signals: [new Signal(StrategyAction.RequestEntry, rule('a', true))],
        }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('version inválida (0, 2.5) → InvalidStrategyDefinitionError', () => {
    for (const version of [0, 2.5]) {
      expect(
        () =>
          new Strategy({
            name: 'test',
            version,
            signals: [new Signal(StrategyAction.RequestEntry, rule('a', true))],
          }),
      ).toThrow(InvalidStrategyDefinitionError)
    }
  })

  it('signals vacíos → InvalidStrategyDefinitionError', () => {
    expect(() => new Strategy({ name: 'test', signals: [] })).toThrow(
      InvalidStrategyDefinitionError,
    )
  })

  it('el error tiene name InvalidStrategyDefinitionError', () => {
    try {
      new Strategy({ name: 'test', signals: [] })
      throw new Error('debía lanzar InvalidStrategyDefinitionError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStrategyDefinitionError)
      expect((error as Error).name).toBe('InvalidStrategyDefinitionError')
    }
  })

  it('toString es "name@version"', () => {
    expect(
      strategyWith([new Signal(StrategyAction.RequestEntry, rule('a', true))], {
        version: 2,
      }).toString(),
    ).toBe('test@2')
  })
})

describe('Strategy.evaluate (aplicabilidad)', () => {
  it('sin posición y RequestEntry dispara → RequestEntry con reason y sin fraction ni price', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('rsi > 30', true))])

    expect(strategy.evaluate(context, false)).toEqual({
      action: StrategyAction.RequestEntry,
      fraction: null,
      price: null,
      reason: 'request_entry: rsi > 30',
    })
  })

  it('sin posición, señales de posición true → None', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestExit, rule('e', true)),
      new Signal(StrategyAction.RequestReduce, rule('r', true), { fraction: 0.5 }),
      new Signal(StrategyAction.RequestAdd, rule('d', true), { fraction: 0.5 }),
    ])

    expect(strategy.evaluate(context, false).action).toBe(StrategyAction.None)
  })

  it('con posición y RequestExit dispara → RequestExit con reason', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestExit, rule('rsi > 70', true))])

    expect(strategy.evaluate(context, true)).toEqual({
      action: StrategyAction.RequestExit,
      fraction: null,
      price: null,
      reason: 'request_exit: rsi > 70',
    })
  })

  it('con posición, solo RequestEntry true → None', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))])

    expect(strategy.evaluate(context, true).action).toBe(StrategyAction.None)
  })

  it('con posición y RequestReduce dispara → RequestReduce con su fraction', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestReduce, rule('r', true), { fraction: 0.25 }),
    ])

    expect(strategy.evaluate(context, true)).toEqual({
      action: StrategyAction.RequestReduce,
      fraction: 0.25,
      price: null,
      reason: 'request_reduce: r',
    })
  })

  it('con posición y RequestAdd dispara → RequestAdd con su fraction', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestAdd, rule('d', true), { fraction: 0.5 }),
    ])

    expect(strategy.evaluate(context, true)).toEqual({
      action: StrategyAction.RequestAdd,
      fraction: 0.5,
      price: null,
      reason: 'request_add: d',
    })
  })

  it('ninguna señal dispara → None con reason null', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', false)),
      new Signal(StrategyAction.RequestExit, rule('b', false)),
    ])

    expect(strategy.evaluate(context, false)).toEqual({
      action: StrategyAction.None,
      fraction: null,
      price: null,
      reason: null,
    })
    expect(strategy.evaluate(context, true).action).toBe(StrategyAction.None)
  })

  it('regla con dato faltante (calentamiento) → None', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, new Greater('rsi', 30))])

    expect(strategy.evaluate(contextWith({ rsi: [50, 50, 50, null] }), false).action).toBe(
      StrategyAction.None,
    )
  })
})

describe('Strategy.evaluate (precio)', () => {
  it('price por alias resuelve el valor en la vela actual', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('target') }),
    ])

    expect(strategy.evaluate(contextWith({ target: [10, 10, 10, 12] }), false).price).toBe(12)
  })

  it('price con indicador constante resuelve su valor (decisión 9)', () => {
    const strategy = strategyWith(
      [new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('fixed') })],
      { indicators: { fixed: new Constant(99.5) } },
    )

    expect(strategy.evaluate(strategy.buildContext(CANDLES), false).price).toBe(99.5)
  })

  it('price en calentamiento → la señal no dispara y gana la siguiente aplicable', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('target') }),
      new Signal(StrategyAction.RequestEntry, rule('b', true)),
    ])
    const decision = strategy.evaluate(contextWith({ target: [null, null, null, null] }), false)

    expect(decision.reason).toBe('request_entry: b')
    expect(decision.price).toBeNull()
  })

  it('price con alias no registrado → MarketContextError', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('ghost') }),
    ])

    expect(() => strategy.evaluate(context, false)).toThrow(MarketContextError)
  })

  it('el precio viaja en la decisión y sin price la decisión va a mercado (price null)', () => {
    const market = strategyWith([new Signal(StrategyAction.RequestEntry, rule('a', true))])
    expect(market.evaluate(context, false).price).toBeNull()

    const limit = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { price: series('target') }),
    ])
    expect(limit.evaluate(contextWith({ target: [10, 10, 10, 12] }), false).price).toBe(12)
  })
})

describe('Strategy.evaluate (prioridad)', () => {
  it('dos señales aplicables disparan → gana la primera declarada', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('first', true)),
      new Signal(StrategyAction.RequestEntry, rule('second', true)),
    ])

    expect(strategy.evaluate(context, false).reason).toBe('request_entry: first')
  })

  it('múltiples salidas: cada señal dispara por su regla respetando el orden', () => {
    const reduceWins = strategyWith([
      new Signal(StrategyAction.RequestExit, rule('e1', false)),
      new Signal(StrategyAction.RequestReduce, rule('r1', true), { fraction: 0.5 }),
      new Signal(StrategyAction.RequestExit, rule('e2', true)),
    ])
    expect(reduceWins.evaluate(context, true).action).toBe(StrategyAction.RequestReduce)

    const exitFirst = strategyWith([
      new Signal(StrategyAction.RequestExit, rule('e1', true)),
      new Signal(StrategyAction.RequestReduce, rule('r1', true), { fraction: 0.5 }),
    ])
    expect(exitFirst.evaluate(context, true).action).toBe(StrategyAction.RequestExit)
  })
})

describe('Strategy.buildContext', () => {
  it('calcula los indicadores declarados y permite evaluar de extremo a extremo', () => {
    const strategy = strategyWith(
      [new Signal(StrategyAction.RequestEntry, new Greater('rsi', 30))],
      {
        indicators: { rsi: new Rsi(2) },
      },
    )

    const built = strategy.buildContext(CANDLES)

    expect(built.value('rsi')).toBe(100)
    expect(strategy.evaluate(built, false).action).toBe(StrategyAction.RequestEntry)
  })
})

describe('Strategy.evaluate (invalidación)', () => {
  const vetoName = 'session closed'
  const vetoOn = rule(vetoName, true)
  const vetoOff = rule(vetoName, false)

  it('veto sin posición → Invalidate con reason del veto, sin evaluar las señales', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))], {
      invalidationRule: vetoOn,
    })

    expect(strategy.evaluate(context, false)).toEqual({
      action: StrategyAction.Invalidate,
      fraction: null,
      price: null,
      reason: vetoName,
    })
  })

  it('veto con posición → RequestReduce y RequestExit siguen disparando', () => {
    const reduceWins = strategyWith(
      [
        new Signal(StrategyAction.RequestExit, rule('e', false)),
        new Signal(StrategyAction.RequestReduce, rule('r', true), { fraction: 0.5 }),
      ],
      { invalidationRule: vetoOn },
    )
    expect(reduceWins.evaluate(context, true).action).toBe(StrategyAction.RequestReduce)

    const exitWins = strategyWith([new Signal(StrategyAction.RequestExit, rule('e', true))], {
      invalidationRule: vetoOn,
    })
    expect(exitWins.evaluate(context, true).action).toBe(StrategyAction.RequestExit)
  })

  it('veto con posición → RequestAdd bloqueado: Invalidate con reason del veto', () => {
    const strategy = strategyWith(
      [new Signal(StrategyAction.RequestAdd, rule('d', true), { fraction: 0.5 })],
      { invalidationRule: vetoOn },
    )

    expect(strategy.evaluate(context, true)).toEqual({
      action: StrategyAction.Invalidate,
      fraction: null,
      price: null,
      reason: vetoName,
    })
  })

  it('veto false → las señales normales disparan', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))], {
      invalidationRule: vetoOff,
    })

    expect(strategy.evaluate(context, false).action).toBe(StrategyAction.RequestEntry)
    expect(strategy.evaluate(context, false).reason).toBe('request_entry: e')
  })

  it('veto con dato faltante (calentamiento) → no invalida y la entrada dispara', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))], {
      invalidationRule: new Greater('rsi', 30),
    })

    expect(strategy.evaluate(contextWith({ rsi: [50, 50, 50, null] }), false).action).toBe(
      StrategyAction.RequestEntry,
    )
  })

  it('sin invalidationRule → las señales se evalúan con normalidad', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))])

    expect(strategy.evaluate(context, false).action).toBe(StrategyAction.RequestEntry)
  })

  it('invalidationRule: null si no se declara, identidad si se declara', () => {
    expect(
      strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))]).invalidationRule,
    ).toBeNull()

    const declared = rule('v', true)
    expect(
      strategyWith([new Signal(StrategyAction.RequestEntry, rule('e', true))], {
        invalidationRule: declared,
      }).invalidationRule,
    ).toBe(declared)
  })
})

describe('Strategy.evaluate (TP/SL)', () => {
  const entrySignal = () => new Signal(StrategyAction.RequestEntry, rule('entry?', false))

  it('SL market: toque low <= sl → RequestExit sin precio, reason stop_loss', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })
    // Vela actual: low = 12 → toca el sl (12 <= 12).
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision).toEqual({
      action: StrategyAction.RequestExit,
      fraction: null,
      price: null,
      reason: 'stop_loss',
    })
  })

  it('SL limit: la decisión lleva el precio del nivel (presencia ⇔ limit)', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'limit' },
      indicators: { slLevel: new Constant(12) },
    })
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.action).toBe(StrategyAction.RequestExit)
    expect(decision.price).toBe(12)
    expect(decision.reason).toBe('stop_loss')
  })

  it('TP: toque high >= tp → RequestExit con reason take_profit', () => {
    const strategy = strategyWith([entrySignal()], {
      takeProfit: { price: series('tpLevel'), execution: 'limit' },
      indicators: { tpLevel: new Constant(14) },
    })
    // Vela actual: high = 14 → toca el tp (14 >= 14).
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.action).toBe(StrategyAction.RequestExit)
    expect(decision.price).toBe(14)
    expect(decision.reason).toBe('take_profit')
  })

  it('prioridad: SL gana a TP cuando ambas tocan en la misma vela', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      takeProfit: { price: series('tpLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12), tpLevel: new Constant(14) },
    })

    expect(strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true).reason).toBe(
      'stop_loss',
    )
  })

  it('prioridad: SL gana a las señales cuando ambas disparan', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestExit, rule('exit?', true))], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.reason).toBe('stop_loss')
  })

  it('sin posición (open=false) → nunca SL/TP, aunque los niveles toquen', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })

    expect(strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), false).action).toBe(
      StrategyAction.None,
    )
  })

  it('sin entry en el contexto (posiciones manuales del replay) → nunca SL/TP', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })

    expect(strategy.evaluate(strategy.buildContext(CANDLES), true).action).toBe(StrategyAction.None)
  })

  it('override de sesión: número gana a la expresión (5 > low no toca)', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })

    expect(
      strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100, sl: 5 }), true).action,
    ).toBe(StrategyAction.None)
    // y el override sí dispara si toca
    expect(
      strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100, sl: 13 }), true).reason,
    ).toBe('stop_loss')
  })

  it('override null desactiva el nivel aunque la expresión tocaría', () => {
    const strategy = strategyWith([entrySignal()], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(12) },
    })

    expect(
      strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100, sl: null }), true).action,
    ).toBe(StrategyAction.None)
  })

  it('las reglas ven los niveles materializados (value("sl"))', () => {
    const slReader: Rule = { name: 'sl == 5', evaluate: (ctx) => ctx.value('sl') === 5 }
    const strategy = strategyWith([new Signal(StrategyAction.RequestExit, slReader)], {
      stopLoss: { price: series('slLevel'), execution: 'market' },
      indicators: { slLevel: new Constant(5) },
    })
    // sl = 5 no toca (low 12 > 5), pero la regla lo ve materializado.
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.action).toBe(StrategyAction.RequestExit)
    expect(decision.reason).toBe('request_exit: sl == 5')
  })

  it('sin stopLoss declarado → no hay SL aunque la sesión pase un override', () => {
    const strategy = strategyWith([entrySignal()])

    expect(
      strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100, sl: 13 }), true).action,
    ).toBe(StrategyAction.None)
  })
})

describe('Trigger', () => {
  it('name es "action @ expr" para observabilidad', () => {
    const trigger = new Trigger({
      price: plus('fast', 'slow'),
      action: StrategyAction.RequestEntry,
      execution: 'limit',
    })

    expect(trigger.name).toBe('request_entry @ fast + slow')
    expect(trigger.fraction).toBeNull()
  })

  it('acción fuera de las cuatro señales → InvalidStrategyDefinitionError', () => {
    expect(
      () =>
        new Trigger({
          price: series('x'),
          action: StrategyAction.None as never,
          execution: 'market',
        }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('execution desconocida → InvalidStrategyDefinitionError', () => {
    expect(
      () =>
        new Trigger({
          price: series('x'),
          action: StrategyAction.RequestEntry,
          execution: 'stop' as never,
        }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('fraction igual que las señales: obligatoria en add/reduce, prohibida en entry/exit', () => {
    expect(
      () =>
        new Trigger({
          price: series('x'),
          action: StrategyAction.RequestAdd,
          execution: 'market',
          fraction: 0.5,
        }),
    ).not.toThrow()
    expect(
      () =>
        new Trigger({ price: series('x'), action: StrategyAction.RequestAdd, execution: 'market' }),
    ).toThrow(InvalidStrategyDefinitionError)
    expect(
      () =>
        new Trigger({
          price: series('x'),
          action: StrategyAction.RequestEntry,
          execution: 'market',
          fraction: 0.5,
        }),
    ).toThrow(InvalidStrategyDefinitionError)
  })

  it('precio literal numérico → InvalidPriceExprError', () => {
    expect(
      () =>
        new Trigger({
          price: 99 as never,
          action: StrategyAction.RequestEntry,
          execution: 'limit',
        }),
    ).toThrow(InvalidPriceExprError)
  })
})

describe('Strategy.evaluate (triggers)', () => {
  /** Señal que nunca dispara (las estrategias requieren ≥ 1 señal). */
  const neverSignal = () => new Signal(StrategyAction.RequestEntry, rule('never', false))

  /** Trigger de compra (low <= price) o venta (high >= price) con nivel constante. */
  function triggerStrategy(
    action: SignalAction,
    level: number,
    execution: OrderExecution,
    warmup = false,
  ): Strategy {
    return strategyWith([neverSignal()], {
      triggers: [
        new Trigger({
          price: series('lvl'),
          action,
          execution,
        }),
      ],
      // Calentamiento: SMA(5) sobre 4 velas → toda la serie en null.
      indicators: { lvl: warmup ? new Sma(5) : new Constant(level) },
    })
  }

  it('compra: toque low <= price → la acción dispara con su precio (limit)', () => {
    // low actual = 12 → un nivel en 13 se toca (12 <= 13).
    const strategy = triggerStrategy(StrategyAction.RequestEntry, 13, 'limit')
    const decision = strategy.evaluate(strategy.buildContext(CANDLES), false)

    expect(decision.action).toBe(StrategyAction.RequestEntry)
    expect(decision.price).toBe(13)
    expect(decision.reason).toBe('request_entry @ lvl')
  })

  it('venta: toque high >= price → la acción dispara', () => {
    // high actual = 14 → un nivel en 13 se toca (14 >= 13).
    const strategy = triggerStrategy(StrategyAction.RequestExit, 13, 'limit')
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.action).toBe(StrategyAction.RequestExit)
    expect(decision.price).toBe(13)
  })

  it('sin toque → no dispara', () => {
    // Compra en 11: low actual 12 > 11 → no toca.
    const strategy = triggerStrategy(StrategyAction.RequestEntry, 11, 'limit')

    expect(strategy.evaluate(strategy.buildContext(CANDLES), false).action).toBe(
      StrategyAction.None,
    )
  })

  it('execution market → la decisión va sin precio (price null)', () => {
    const strategy = triggerStrategy(StrategyAction.RequestEntry, 13, 'market')
    const decision = strategy.evaluate(strategy.buildContext(CANDLES), false)

    expect(decision.action).toBe(StrategyAction.RequestEntry)
    expect(decision.price).toBeNull()
  })

  it('calentamiento (expresión sin resolver) → el trigger no dispara', () => {
    const strategy = triggerStrategy(StrategyAction.RequestEntry, 13, 'limit', true)

    expect(strategy.evaluate(strategy.buildContext(CANDLES), false).action).toBe(
      StrategyAction.None,
    )
  })

  it('applicabilidad: request_entry solo sin posición; request_exit solo con posición', () => {
    const buy = triggerStrategy(StrategyAction.RequestEntry, 13, 'limit')
    expect(buy.evaluate(buy.buildContext(CANDLES, { entry: 100 }), true).action).toBe(
      StrategyAction.None,
    )

    const sell = triggerStrategy(StrategyAction.RequestExit, 13, 'limit')
    expect(sell.evaluate(sell.buildContext(CANDLES), false).action).toBe(StrategyAction.None)
  })

  it('el veto bloquea triggers de add pero nunca los de venta', () => {
    const vetoOn = rule('veto', true)
    const add = strategyWith([neverSignal()], {
      invalidationRule: vetoOn,
      triggers: [
        new Trigger({
          price: series('lvl'),
          action: StrategyAction.RequestAdd,
          execution: 'limit',
          fraction: 0.5,
        }),
      ],
      indicators: { lvl: new Constant(13) },
    })
    // add requiere !vetoed → no dispara; el veto degrada la decisión a Invalidate.
    expect(add.evaluate(add.buildContext(CANDLES, { entry: 100 }), true).action).toBe(
      StrategyAction.Invalidate,
    )

    const sell = strategyWith([neverSignal()], {
      invalidationRule: vetoOn,
      triggers: [
        new Trigger({
          price: series('lvl'),
          action: StrategyAction.RequestExit,
          execution: 'limit',
        }),
      ],
      indicators: { lvl: new Constant(13) },
    })
    expect(sell.evaluate(sell.buildContext(CANDLES, { entry: 100 }), true).action).toBe(
      StrategyAction.RequestExit,
    )
  })

  it('prioridad: las señales (reglas) ganan a los triggers', () => {
    const strategy = strategyWith([new Signal(StrategyAction.RequestExit, rule('exit?', true))], {
      triggers: [
        new Trigger({
          price: series('lvl'),
          action: StrategyAction.RequestExit,
          execution: 'limit',
        }),
      ],
      indicators: { lvl: new Constant(13) },
    })
    const decision = strategy.evaluate(strategy.buildContext(CANDLES, { entry: 100 }), true)

    expect(decision.reason).toBe('request_exit: exit?')
  })
})
