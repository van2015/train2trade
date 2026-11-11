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
    new Signal(StrategyAction.RequestEntry, rule('go', true)),
    new Signal(StrategyAction.RequestExit, rule('stop', true)),
  ],
})

describe('StrategyInstance (construcción)', () => {
  it('estado inicial WaitingForSignal por defecto, personalizado respetado, strategy identidad', () => {
    expect(new StrategyInstance(strategy).state).toBe(StrategyState.WaitingForSignal)
    expect(new StrategyInstance(strategy, StrategyState.WaitingForExitSignal).state).toBe(
      StrategyState.WaitingForExitSignal,
    )
    expect(new StrategyInstance(strategy).strategy).toBe(strategy)
  })

  it.each([
    [StrategyState.WaitingForSignal, false, false],
    [StrategyState.WaitingForEntryFill, false, true],
    [StrategyState.WaitingForExitSignal, true, false],
    [StrategyState.WaitingForExitFill, true, false],
  ] as const)('%s → open=%s entryPending=%s', (state, open, entryPending) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.state).toBe(state)
    expect(instance.open).toBe(open)
    expect(instance.entryPending).toBe(entryPending)
  })
})

describe('StrategyInstance.apply', () => {
  it('RequestEntry desde WaitingForSignal → WaitingForEntryFill con evento StrategyConfirmed', () => {
    const instance = new StrategyInstance(strategy)

    expect(instance.apply(decision(StrategyAction.RequestEntry))).toEqual({
      from: StrategyState.WaitingForSignal,
      to: StrategyState.WaitingForEntryFill,
      changed: true,
      event: 'StrategyConfirmed',
    })
    expect(instance.state).toBe(StrategyState.WaitingForEntryFill)
  })

  it('RequestEntry desde WaitingForEntryFill → refresh sin cambio', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForEntryFill)

    expect(instance.apply(decision(StrategyAction.RequestEntry))).toEqual({
      from: StrategyState.WaitingForEntryFill,
      to: StrategyState.WaitingForEntryFill,
      changed: false,
      event: null,
    })
  })

  it('Invalidate desde WaitingForEntryFill → WaitingForSignal con evento EntryCancelled', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForEntryFill)

    expect(instance.apply(decision(StrategyAction.Invalidate))).toEqual({
      from: StrategyState.WaitingForEntryFill,
      to: StrategyState.WaitingForSignal,
      changed: true,
      event: 'EntryCancelled',
    })
    expect(instance.state).toBe(StrategyState.WaitingForSignal)
  })

  it('RequestExit desde WaitingForExitSignal → WaitingForExitFill con evento ExitRequested', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForExitSignal)

    expect(instance.apply(decision(StrategyAction.RequestExit))).toEqual({
      from: StrategyState.WaitingForExitSignal,
      to: StrategyState.WaitingForExitFill,
      changed: true,
      event: 'ExitRequested',
    })
    expect(instance.state).toBe(StrategyState.WaitingForExitFill)
  })

  it('RequestExit desde WaitingForExitFill → refresh sin cambio', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForExitFill)

    expect(instance.apply(decision(StrategyAction.RequestExit))).toEqual({
      from: StrategyState.WaitingForExitFill,
      to: StrategyState.WaitingForExitFill,
      changed: false,
      event: null,
    })
  })

  it.each([
    StrategyState.WaitingForSignal,
    StrategyState.WaitingForEntryFill,
    StrategyState.WaitingForExitSignal,
    StrategyState.WaitingForExitFill,
  ])('None en %s → sin cambio ni evento', (state) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.apply(decision(StrategyAction.None))).toEqual({
      from: state,
      to: state,
      changed: false,
      event: null,
    })
  })

  it.each([
    StrategyState.WaitingForSignal,
    StrategyState.WaitingForExitSignal,
    StrategyState.WaitingForExitFill,
  ])('Invalidate en %s (sin orden de entrada pendiente) → sin cambio ni evento', (state) => {
    const instance = new StrategyInstance(strategy, state)

    expect(instance.apply(decision(StrategyAction.Invalidate))).toEqual({
      from: state,
      to: state,
      changed: false,
      event: null,
    })
  })

  it.each([
    [StrategyState.WaitingForExitSignal, StrategyAction.RequestAdd],
    [StrategyState.WaitingForExitSignal, StrategyAction.RequestReduce],
    [StrategyState.WaitingForExitFill, StrategyAction.RequestAdd],
    [StrategyState.WaitingForExitFill, StrategyAction.RequestReduce],
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
  it('WaitingForEntryFill → WaitingForExitSignal con evento PositionOpened', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForEntryFill)

    expect(instance.onFill()).toEqual({
      from: StrategyState.WaitingForEntryFill,
      to: StrategyState.WaitingForExitSignal,
      changed: true,
      event: 'PositionOpened',
    })
    expect(instance.state).toBe(StrategyState.WaitingForExitSignal)
  })

  it('WaitingForExitFill → WaitingForSignal con evento PositionClosed', () => {
    const instance = new StrategyInstance(strategy, StrategyState.WaitingForExitFill)

    expect(instance.onFill()).toEqual({
      from: StrategyState.WaitingForExitFill,
      to: StrategyState.WaitingForSignal,
      changed: true,
      event: 'PositionClosed',
    })
    expect(instance.state).toBe(StrategyState.WaitingForSignal)
  })

  it('sin orden pendiente (WaitingForSignal, WaitingForExitSignal) → InvalidStrategyTransitionError', () => {
    for (const state of [StrategyState.WaitingForSignal, StrategyState.WaitingForExitSignal]) {
      expect(() => new StrategyInstance(strategy, state).onFill()).toThrow(
        InvalidStrategyTransitionError,
      )
    }
  })
})

describe('StrategyInstance (decisiones imposibles)', () => {
  it.each([
    [StrategyState.WaitingForExitSignal, StrategyAction.RequestEntry],
    [StrategyState.WaitingForExitFill, StrategyAction.RequestEntry],
    [StrategyState.WaitingForSignal, StrategyAction.RequestExit],
    [StrategyState.WaitingForEntryFill, StrategyAction.RequestExit],
    [StrategyState.WaitingForSignal, StrategyAction.RequestAdd],
    [StrategyState.WaitingForEntryFill, StrategyAction.RequestReduce],
  ] as const)('%s + %s → InvalidStrategyTransitionError', (state, action) => {
    const instance = new StrategyInstance(strategy, state)

    expect(() => instance.apply(decision(action, 0.5))).toThrow(InvalidStrategyTransitionError)
  })

  it('el error tiene name InvalidStrategyTransitionError', () => {
    try {
      new StrategyInstance(strategy).apply(decision(StrategyAction.RequestExit))
      throw new Error('debía lanzar InvalidStrategyTransitionError')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStrategyTransitionError)
      expect((error as Error).name).toBe('InvalidStrategyTransitionError')
    }
  })
})

describe('StrategyInstance (integración con evaluate)', () => {
  it('ciclo completo: señal → fill → señal → fill hasta WaitingForSignal', () => {
    const instance = new StrategyInstance(strategy)

    // WaitingForSignal → evaluate sin posición emite RequestEntry
    const enter = strategy.evaluate(context, instance.open)
    expect(enter.action).toBe(StrategyAction.RequestEntry)
    instance.apply(enter)
    expect(instance.state).toBe(StrategyState.WaitingForEntryFill)

    // entrada rellenada
    instance.onFill()
    expect(instance.state).toBe(StrategyState.WaitingForExitSignal)

    // WaitingForExitSignal → evaluate con posición emite RequestExit
    const exit = strategy.evaluate(context, instance.open)
    expect(exit.action).toBe(StrategyAction.RequestExit)
    instance.apply(exit)
    expect(instance.state).toBe(StrategyState.WaitingForExitFill)

    // salida rellenada
    instance.onFill()
    expect(instance.state).toBe(StrategyState.WaitingForSignal)
  })

  it('veto con entrada pendiente: evaluate emite Invalidate y apply retira la orden', () => {
    const vetoStrategy = new Strategy({
      name: 'vetoed',
      signals: [new Signal(StrategyAction.RequestEntry, rule('go', true))],
      invalidationRule: rule('session closed', true),
    })
    const instance = new StrategyInstance(vetoStrategy, StrategyState.WaitingForEntryFill)

    const vetoDecision = vetoStrategy.evaluate(context, instance.open)
    expect(vetoDecision.action).toBe(StrategyAction.Invalidate)

    instance.apply(vetoDecision)
    expect(instance.state).toBe(StrategyState.WaitingForSignal)

    // Invalidar otra vez sin orden de entrada pendiente → no-op, no lanza.
    expect(instance.apply(vetoDecision)).toEqual({
      from: StrategyState.WaitingForSignal,
      to: StrategyState.WaitingForSignal,
      changed: false,
      event: null,
    })
  })
})
