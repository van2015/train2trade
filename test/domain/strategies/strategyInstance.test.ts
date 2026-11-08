import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { MarketContext } from '@/domain/strategies/marketContext'
import { Rule } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction, StrategyDecision } from '@/domain/strategies/strategy'
import {
  InvalidStrategyTransitionError,
  StrategyInstance,
  StrategyState,
} from '@/domain/strategies/strategyInstance'

function candle(time: number, close: number): Candle {
  return Candle.from({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 })
}

const CANDLES: Candle[] = [candle(1000, 10), candle(2000, 11), candle(3000, 12), candle(4000, 13)]

const context = MarketContext.from({ candles: CANDLES })

function rule(name: string, result: boolean): Rule {
  return { name, evaluate: () => result }
}

function decision(action: StrategyAction, fraction: number | null = null): StrategyDecision {
  return { action, fraction, price: null, reason: null }
}

const strategy = new Strategy({
  name: 'test',
  signals: [
    new Signal(StrategyAction.Enter, rule('go', true)),
    new Signal(StrategyAction.Exit, rule('stop', true)),
  ],
})

describe('StrategyInstance (construcción)', () => {
  it('estado inicial Closed por defecto, personalizado respetado, strategy identidad', () => {
    expect(new StrategyInstance(strategy).state).toBe(StrategyState.Closed)
    expect(new StrategyInstance(strategy, StrategyState.Opened).state).toBe(StrategyState.Opened)
    expect(new StrategyInstance(strategy).strategy).toBe(strategy)
  })

  it.each([
    [StrategyState.Closed, false, false],
    [StrategyState.Confirmed, false, true],
    [StrategyState.Opened, true, false],
    [StrategyState.Closing, true, false],
  ] as const)('%s → open=%s entryPending=%s', (state, open, entryPending) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.state).toBe(state)
    expect(instance.open).toBe(open)
    expect(instance.entryPending).toBe(entryPending)
  })
})

describe('StrategyInstance.apply', () => {
  it('Enter desde Closed → Confirmed con evento StrategyConfirmed', () => {
    const instance = new StrategyInstance(strategy)

    expect(instance.apply(decision(StrategyAction.Enter))).toEqual({
      from: StrategyState.Closed,
      to: StrategyState.Confirmed,
      changed: true,
      event: 'StrategyConfirmed',
    })
    expect(instance.state).toBe(StrategyState.Confirmed)
  })

  it('Enter desde Confirmed → refresh sin cambio', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Confirmed)

    expect(instance.apply(decision(StrategyAction.Enter))).toEqual({
      from: StrategyState.Confirmed,
      to: StrategyState.Confirmed,
      changed: false,
      event: null,
    })
  })

  it('Cancel desde Confirmed → Closed con evento EntryCancelled', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Confirmed)

    expect(instance.apply(decision(StrategyAction.Cancel))).toEqual({
      from: StrategyState.Confirmed,
      to: StrategyState.Closed,
      changed: true,
      event: 'EntryCancelled',
    })
    expect(instance.state).toBe(StrategyState.Closed)
  })

  it('Exit desde Opened → Closing con evento ExitRequested', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Opened)

    expect(instance.apply(decision(StrategyAction.Exit))).toEqual({
      from: StrategyState.Opened,
      to: StrategyState.Closing,
      changed: true,
      event: 'ExitRequested',
    })
    expect(instance.state).toBe(StrategyState.Closing)
  })

  it('Exit desde Closing → refresh sin cambio', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Closing)

    expect(instance.apply(decision(StrategyAction.Exit))).toEqual({
      from: StrategyState.Closing,
      to: StrategyState.Closing,
      changed: false,
      event: null,
    })
  })

  it.each([
    StrategyState.Closed,
    StrategyState.Confirmed,
    StrategyState.Opened,
    StrategyState.Closing,
  ])('Hold en %s → sin cambio ni evento', (state) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.apply(decision(StrategyAction.Hold))).toEqual({
      from: state,
      to: state,
      changed: false,
      event: null,
    })
  })

  it.each([
    [StrategyState.Opened, StrategyAction.Add],
    [StrategyState.Opened, StrategyAction.Reduce],
    [StrategyState.Closing, StrategyAction.Add],
    [StrategyState.Closing, StrategyAction.Reduce],
  ] as const)('%s + %s → sin cambio', (state, action) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.apply(decision(action, 0.5))).toEqual({
      from: state,
      to: state,
      changed: false,
      event: null,
    })
  })
})

describe('StrategyInstance.onFill', () => {
  it('Confirmed → Opened con evento PositionOpened', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Confirmed)

    expect(instance.onFill()).toEqual({
      from: StrategyState.Confirmed,
      to: StrategyState.Opened,
      changed: true,
      event: 'PositionOpened',
    })
    expect(instance.state).toBe(StrategyState.Opened)
  })

  it('Closing → Closed con evento PositionClosed', () => {
    const instance = new StrategyInstance(strategy, StrategyState.Closing)

    expect(instance.onFill()).toEqual({
      from: StrategyState.Closing,
      to: StrategyState.Closed,
      changed: true,
      event: 'PositionClosed',
    })
    expect(instance.state).toBe(StrategyState.Closed)
  })

  it('sin orden pendiente (Closed, Opened) → InvalidStrategyTransitionError', () => {
    for (const state of [StrategyState.Closed, StrategyState.Opened]) {
      expect(() => new StrategyInstance(strategy, state).onFill()).toThrow(
        InvalidStrategyTransitionError,
      )
    }
  })
})

describe('StrategyInstance (decisiones imposibles)', () => {
  it.each([
    [StrategyState.Opened, StrategyAction.Enter],
    [StrategyState.Closing, StrategyAction.Enter],
    [StrategyState.Closed, StrategyAction.Cancel],
    [StrategyState.Opened, StrategyAction.Cancel],
    [StrategyState.Closed, StrategyAction.Exit],
    [StrategyState.Confirmed, StrategyAction.Exit],
    [StrategyState.Closed, StrategyAction.Add],
    [StrategyState.Confirmed, StrategyAction.Reduce],
  ] as const)('%s + %s → InvalidStrategyTransitionError', (state, action) => {
    const instance = new StrategyInstance(strategy, state)

    expect(() => instance.apply(decision(action, 0.5))).toThrow(InvalidStrategyTransitionError)
  })

  it('el error tiene name InvalidStrategyTransitionError', () => {
    try {
      new StrategyInstance(strategy).apply(decision(StrategyAction.Exit))
      throw new Error('debía lanzar InvalidStrategyTransitionError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStrategyTransitionError)
      expect((error as Error).name).toBe('InvalidStrategyTransitionError')
    }
  })
})

describe('StrategyInstance (integración con evaluate)', () => {
  it('ciclo completo: señal → fill → señal → fill hasta Closed', () => {
    const instance = new StrategyInstance(strategy)

    // Closed → evaluate sin posición emite Enter
    const enter = strategy.evaluate(context, instance.open, instance.entryPending)
    expect(enter.action).toBe(StrategyAction.Enter)
    instance.apply(enter)
    expect(instance.state).toBe(StrategyState.Confirmed)

    // entrada rellenada
    instance.onFill()
    expect(instance.state).toBe(StrategyState.Opened)

    // Opened → evaluate con posición emite Exit
    const exit = strategy.evaluate(context, instance.open, instance.entryPending)
    expect(exit.action).toBe(StrategyAction.Exit)
    instance.apply(exit)
    expect(instance.state).toBe(StrategyState.Closing)

    // salida rellenada
    instance.onFill()
    expect(instance.state).toBe(StrategyState.Closed)
  })

  it('veto con entrada pendiente: evaluate emite Cancel y apply vuelve a Closed', () => {
    const vetoStrategy = new Strategy({
      name: 'vetoed',
      signals: [new Signal(StrategyAction.Enter, rule('go', true))],
      invalidationRule: rule('session closed', true),
    })
    const instance = new StrategyInstance(vetoStrategy, StrategyState.Confirmed)

    const vetoDecision = vetoStrategy.evaluate(context, instance.open, instance.entryPending)
    expect(vetoDecision.action).toBe(StrategyAction.Cancel)

    instance.apply(vetoDecision)
    expect(instance.state).toBe(StrategyState.Closed)
    // Cancel ya no es aplicable fuera de Confirmed
    expect(() => instance.apply(vetoDecision)).toThrow(InvalidStrategyTransitionError)
  })
})
