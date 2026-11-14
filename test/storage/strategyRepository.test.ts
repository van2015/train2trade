import { beforeEach, describe, expect, it } from 'vitest'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { InvalidStrategyDefinitionError } from '@/domain/strategies/strategy'
import { CorruptedStorageError } from '@/storage/errors'
import {
  DEMO_STRATEGY_SPEC,
  StrategyRepository,
  StrategySnapshot,
} from '@/storage/strategyRepository'

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

/** Spec válida de referencia (entrada a mercado + salida por cruce). */
function spec(overrides: Partial<StrategySpec> = {}): StrategySpec {
  return {
    name: 'demo',
    version: 1,
    indicators: [
      { alias: 'fast', kind: 'sma', period: 10 },
      { alias: 'slow', kind: 'sma', period: 30 },
    ],
    entry: {
      rule: { kind: 'condition', op: 'crosses_above', a: 'fast', b: 'slow' },
      execution: 'market',
    },
    exitRule: { kind: 'condition', op: 'crosses_below', a: 'fast', b: 'slow' },
    ...overrides,
  }
}

let storage: MemoryStorage
let repository: StrategyRepository

beforeEach(() => {
  storage = new MemoryStorage()
  repository = new StrategyRepository(storage)
})

describe('StrategyRepository — roundtrip (§12C)', () => {
  it('save devuelve el id y find recupera el snapshot completo', () => {
    const id = repository.save(spec())

    const found = repository.find(id)
    expect(found).toEqual({ id, ...spec() })
    expect(found?.id).toBe(id)
  })

  it('find de id inexistente → null', () => {
    expect(repository.find('nope')).toBeNull()
  })

  it('misma spec dos veces → mismo id y una sola entrada (dedupe)', () => {
    const first = repository.save(spec())
    const second = repository.save(spec())

    expect(second).toBe(first)
    expect(repository.list()).toHaveLength(1)
  })

  it('specs distintas → ids distintos (hash de contenido)', () => {
    const a = repository.save(spec())
    const b = repository.save(spec({ name: 'otra' }))

    expect(a).not.toBe(b)
    expect(repository.list()).toHaveLength(2)
  })
})

describe('StrategyRepository — list', () => {
  it('ordena por name ascendente, luego version descendente, luego id', () => {
    repository.save(spec({ name: 'beta', version: 1 }))
    repository.save(spec({ name: 'alpha', version: 1 }))
    repository.save(spec({ name: 'alpha', version: 2 }))

    const listed: StrategySnapshot[] = repository.list()
    expect(listed.map((snapshot) => [snapshot.name, snapshot.version])).toEqual([
      ['alpha', 2],
      ['alpha', 1],
      ['beta', 1],
    ])
  })
})

describe('StrategyRepository — remove y clear', () => {
  it('remove devuelve true si existía y false si no', () => {
    const id = repository.save(spec())

    expect(repository.remove(id)).toBe(true)
    expect(repository.remove(id)).toBe(false)
    expect(repository.list()).toHaveLength(0)
  })

  it('clear elimina solo las claves de estrategias', () => {
    storage.setItem('candles:BTC/USDT:1h', '[]')
    storage.setItem('experiments:other', '{}')
    repository.save(spec())

    repository.clear()

    expect(repository.list()).toHaveLength(0)
    expect(storage.getItem('candles:BTC/USDT:1h')).toBe('[]')
    expect(storage.getItem('experiments:other')).toBe('{}')
  })
})

describe('StrategyRepository — datos corruptos (lectura)', () => {
  it('JSON inválido → CorruptedStorageError (find y list)', () => {
    storage.setItem('strategies:bad', '{oops')

    expect(() => repository.find('bad')).toThrow(CorruptedStorageError)
    expect(() => repository.list()).toThrow(CorruptedStorageError)
  })

  it('spec con forma inválida → CorruptedStorageError', () => {
    storage.setItem('strategies:shape', JSON.stringify({ name: '' }))

    expect(() => repository.find('shape')).toThrow(CorruptedStorageError)
  })

  it('price con literal numérico → CorruptedStorageError (envuelve el error de dominio)', () => {
    const broken = {
      ...spec(),
      takeProfit: { price: 99, execution: 'limit' },
    }
    storage.setItem('strategies:price', JSON.stringify(broken))

    expect(() => repository.find('price')).toThrow(CorruptedStorageError)
  })
})

describe('StrategyRepository — guardado inválido (escritura)', () => {
  it('save con spec malformada → InvalidStrategyDefinitionError (no es dato corrupto)', () => {
    expect(() => repository.save({ name: '' } as never)).toThrow(InvalidStrategyDefinitionError)
    expect(repository.list()).toHaveLength(0)
  })
})

describe('StrategyRepository — semilla (§1.7)', () => {
  it('vacío → seedIfEmpty guarda la demo y devuelve true (idempotente)', () => {
    expect(repository.seedIfEmpty()).toBe(true)
    expect(repository.list()).toHaveLength(1)
    expect(repository.list()[0]?.name).toBe('sma-cross')

    expect(repository.seedIfEmpty()).toBe(false)
    expect(repository.list()).toHaveLength(1)
  })

  it('con datos existentes → no siembra nada', () => {
    repository.save(spec())

    expect(repository.seedIfEmpty()).toBe(false)
    expect(repository.list()).toHaveLength(1)
    expect(repository.list()[0]?.name).toBe('demo')
  })

  it('la demo sembrada es buildable (buildStrategy no lanza)', () => {
    expect(() => buildStrategy(DEMO_STRATEGY_SPEC)).not.toThrow()
  })
})
