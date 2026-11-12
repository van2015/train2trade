import { beforeEach, describe, expect, it } from 'vitest'
import { Experiment } from '@/domain/backtest/experiment'
import { Trade } from '@/domain/backtest/trade'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Sma } from '@/domain/indicators/sma'
import { CrossesAbove, CrossesBelow } from '@/domain/strategies/rules'
import { Signal, Strategy, StrategyAction } from '@/domain/strategies/strategy'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { CorruptedStorageError } from '@/storage/errors'

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

const t0 = 1_700_000_000_000
const stepMs = 60_000
const PRICES = [100, 100, 100, 90, 130, 130, 130, 100, 100]

function candlesFrom(offsetMs: number): Candle[] {
  return PRICES.map((price, index) =>
    Candle.from({
      time: t0 + offsetMs + index * stepMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
    }),
  )
}

function crossStrategy(name = 'cross-e2e'): Strategy {
  return new Strategy({
    name,
    indicators: { fast: new Sma(2), slow: new Sma(3) },
    signals: [
      new Signal(StrategyAction.RequestEntry, new CrossesAbove('fast', 'slow')),
      new Signal(StrategyAction.RequestExit, new CrossesBelow('fast', 'slow')),
    ],
  })
}

function experiment(overrides: Partial<Parameters<typeof Experiment.run>[0]> = {}): Experiment {
  return Experiment.run({
    strategy: crossStrategy(),
    candles: candlesFrom(0),
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  })
}

let storage: MemoryStorage
let repository: ExperimentRepository

beforeEach(() => {
  storage = new MemoryStorage()
  repository = new ExperimentRepository(storage)
})

describe('ExperimentRepository — roundtrip (§9/§12C)', () => {
  it('save → find devuelve el mismo snapshot (trades reconstruidos como Trade)', () => {
    const snapshot = experiment().toSnapshot()
    repository.save(snapshot)

    const found = repository.find(snapshot.id)
    expect(found).toEqual(snapshot)
    expect(found?.trades[0]).toBeInstanceOf(Trade)
    expect(found?.trades).toHaveLength(1)
  })

  it('find de id inexistente → null', () => {
    expect(repository.find('nope')).toBeNull()
  })

  it('mismo experimento dos veces → mismo id y una sola entrada (dedupe)', () => {
    const first = experiment().toSnapshot()
    const second = experiment().toSnapshot()
    expect(second.id).toBe(first.id)

    repository.save(first)
    repository.save(second)

    expect(repository.list()).toHaveLength(1)
  })

  it('list ordena por period.from descendente; empate por id ascendente', () => {
    const older = experiment().toSnapshot() // periodo t0
    const newer = experiment({ candles: candlesFrom(86_400_000) }).toSnapshot() // +1 día
    const samePeriod = experiment({ strategy: crossStrategy('otra') }).toSnapshot() // mismo periodo, id distinto
    expect(samePeriod.period.from).toBe(older.period.from)

    repository.save(older)
    repository.save(newer)
    repository.save(samePeriod)

    const expectedTail = [older.id, samePeriod.id].sort()
    expect(repository.list().map((snapshot) => snapshot.id)).toEqual([newer.id, ...expectedTail])
  })
})

describe('ExperimentRepository — remove y clear', () => {
  it('remove devuelve true si existía y false si no', () => {
    const snapshot = experiment().toSnapshot()
    repository.save(snapshot)

    expect(repository.remove(snapshot.id)).toBe(true)
    expect(repository.remove(snapshot.id)).toBe(false)
    expect(repository.list()).toHaveLength(0)
  })

  it('clear elimina solo las claves de experimentos', () => {
    storage.setItem('candles:BTC/USDT:1h', '[]')
    repository.save(experiment().toSnapshot())

    repository.clear()

    expect(repository.list()).toHaveLength(0)
    expect(storage.getItem('candles:BTC/USDT:1h')).toBe('[]')
  })
})

describe('ExperimentRepository — datos corruptos', () => {
  it('JSON inválido → CorruptedStorageError (list y find)', () => {
    storage.setItem('experiments:bad', '{oops')

    expect(() => repository.find('bad')).toThrow(CorruptedStorageError)
    expect(() => repository.list()).toThrow(CorruptedStorageError)
  })

  it('snapshot con forma inválida → CorruptedStorageError', () => {
    storage.setItem('experiments:shape', JSON.stringify({ id: 'shape' }))

    expect(() => repository.find('shape')).toThrow(CorruptedStorageError)
  })

  it('trades inválidos dentro de un snapshot válido → CorruptedStorageError', () => {
    const snapshot = experiment().toSnapshot()
    const corrupted = JSON.parse(JSON.stringify(snapshot)) as {
      trades: { qty: number }[]
    }
    corrupted.trades[0]!.qty = -1
    storage.setItem(`experiments:${snapshot.id}`, JSON.stringify(corrupted))

    expect(() => repository.find(snapshot.id)).toThrow(CorruptedStorageError)
  })
})
