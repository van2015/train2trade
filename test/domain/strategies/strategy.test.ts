import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { Rsi } from '@/domain/indicators/rsi'
import { MarketContext, MarketContextError } from '@/domain/strategies/marketContext'
import { Greater, Rule } from '@/domain/strategies/rules'
import {
  InvalidStrategyDefinitionError,
  Signal,
  Strategy,
  StrategyAction,
  StrategyDefinition,
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
  it('name es "accion: rule.name" y con limitPrice añade "@ ref"', () => {
    expect(new Signal(StrategyAction.RequestEntry, rule('rsi > 30', true)).name).toBe(
      'request_entry: rsi > 30',
    )
    expect(
      new Signal(StrategyAction.RequestExit, rule('rsi > 70', true), { limitPrice: 'sma20' }).name,
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

  it('limitPrice acepta alias y constante sin error', () => {
    expect(
      () => new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 'sma20' }),
    ).not.toThrow()
    expect(
      () => new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 99.5 }),
    ).not.toThrow()
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
  it('limitPrice por alias resuelve el valor en la vela actual', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 'target' }),
    ])

    expect(strategy.evaluate(contextWith({ target: [10, 10, 10, 12] }), false).price).toBe(12)
  })

  it('limitPrice por constante resuelve esa constante', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 99.5 }),
    ])

    expect(strategy.evaluate(context, false).price).toBe(99.5)
  })

  it('limitPrice en calentamiento → la señal no dispara y gana la siguiente aplicable', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 'target' }),
      new Signal(StrategyAction.RequestEntry, rule('b', true)),
    ])
    const decision = strategy.evaluate(contextWith({ target: [null, null, null, null] }), false)

    expect(decision.reason).toBe('request_entry: b')
    expect(decision.price).toBeNull()
  })

  it('limitPrice con alias no registrado → MarketContextError', () => {
    const strategy = strategyWith([
      new Signal(StrategyAction.RequestEntry, rule('a', true), { limitPrice: 'ghost' }),
    ])

    expect(() => strategy.evaluate(context, false)).toThrow(MarketContextError)
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
