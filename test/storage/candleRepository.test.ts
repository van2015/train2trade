import { beforeEach, describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'
import { CandleRepository, CorruptedStorageError } from '@/storage/candleRepository'

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

function candle(time: number, close = 1.5): Candle {
  return Candle.from({ time, open: 1, high: 2, low: 0.5, close, volume: 10 })
}

const BTC_USDT = Instrument.of('BTC', 'USDT')
const ETH_USDT = Instrument.of('ETH', 'USDT')
const BTC_KEY = 'candles:BTC/USDT:1h'

let storage: MemoryStorage
let repository: CandleRepository

describe('CandleRepository', () => {
  beforeEach(() => {
    storage = new MemoryStorage()
    repository = new CandleRepository(storage)
  })

  describe('save / find', () => {
    it('guarda y devuelve las velas ordenadas ascendentes', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(3000), candle(1000), candle(2000)])

      expect(repository.find(BTC_USDT, Timeframe.HOUR)).toEqual([
        candle(1000),
        candle(2000),
        candle(3000),
      ])
    })

    it('acumula entre guardados: dedupe con gana-la-nueva y orden final', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000), candle(2000)])
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(2000, 9), candle(3000)])

      expect(repository.find(BTC_USDT, Timeframe.HOUR)).toEqual([
        candle(1000),
        candle(2000, 9),
        candle(3000),
      ])
    })

    it('save([]) es no-op: no crea clave y count es 0', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [])

      expect(repository.count(BTC_USDT, Timeframe.HOUR)).toBe(0)
      expect(repository.listInstruments()).toEqual([])
    })

    it('persiste entre instancias sobre el mismo storage', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000)])
      const other = new CandleRepository(storage)

      expect(other.find(BTC_USDT, Timeframe.HOUR)).toEqual([candle(1000)])
    })

    it('find devuelve instancias de Candle revividas, no JSON crudo', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000)])
      const [first] = repository.find(BTC_USDT, Timeframe.HOUR)

      expect(first).toBeInstanceOf(Candle)
    })
  })

  describe('find con rango', () => {
    beforeEach(() => {
      repository.save(BTC_USDT, Timeframe.HOUR, [
        candle(1000),
        candle(2000),
        candle(3000),
        candle(4000),
        candle(5000),
      ])
    })

    it('filtra por [from, to] inclusivo', () => {
      expect(repository.find(BTC_USDT, Timeframe.HOUR, { from: 2000, to: 4000 })).toEqual([
        candle(2000),
        candle(3000),
        candle(4000),
      ])
    })

    it('sin coincidencias devuelve []', () => {
      expect(repository.find(BTC_USDT, Timeframe.HOUR, { from: 9000, to: 10000 })).toEqual([])
    })

    it('un rango invertido lanza RangeError', () => {
      expect(() => repository.find(BTC_USDT, Timeframe.HOUR, { from: 4000, to: 1000 })).toThrow(
        RangeError,
      )
    })
  })

  describe('aislamiento de claves', () => {
    it('BTC/1h, BTC/4h y ETH/1h son independientes', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000), candle(2000)])
      repository.save(BTC_USDT, Timeframe.FOUR_HOURS, [candle(3000)])
      repository.save(ETH_USDT, Timeframe.HOUR, [candle(4000)])

      expect(repository.find(BTC_USDT, Timeframe.HOUR)).toEqual([candle(1000), candle(2000)])
      expect(repository.find(BTC_USDT, Timeframe.FOUR_HOURS)).toEqual([candle(3000)])
      expect(repository.find(ETH_USDT, Timeframe.HOUR)).toEqual([candle(4000)])
    })

    it('persiste como JSON plano bajo la clave del instrumento y timeframe', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000)])
      const raw = storage.getItem(BTC_KEY)

      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw ?? 'null')
      expect(parsed).toEqual([{ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }])
      expect(parsed[0]).not.toBeInstanceOf(Candle)
    })
  })

  describe('count / remove / clear', () => {
    it('count es 0 sin datos y n tras guardar', () => {
      expect(repository.count(BTC_USDT, Timeframe.HOUR)).toBe(0)

      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000), candle(2000)])

      expect(repository.count(BTC_USDT, Timeframe.HOUR)).toBe(2)
    })

    it('remove devuelve true con datos y false sin datos', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000)])

      expect(repository.remove(BTC_USDT, Timeframe.HOUR)).toBe(true)
      expect(repository.find(BTC_USDT, Timeframe.HOUR)).toEqual([])
      expect(repository.remove(BTC_USDT, Timeframe.HOUR)).toBe(false)
    })

    it('clear borra todas las claves de velas y deja las claves ajenas', () => {
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(1000)])
      repository.save(ETH_USDT, Timeframe.FOUR_HOURS, [candle(2000)])
      storage.setItem('estrategia:clave', 'intacto')

      repository.clear()

      expect(repository.find(BTC_USDT, Timeframe.HOUR)).toEqual([])
      expect(repository.find(ETH_USDT, Timeframe.FOUR_HOURS)).toEqual([])
      expect(storage.getItem('estrategia:clave')).toBe('intacto')
    })
  })

  describe('listados', () => {
    it('listTimeframes devuelve los timeframes con datos del instrumento, por ms ascendente', () => {
      repository.save(BTC_USDT, Timeframe.FOUR_HOURS, [candle(1000)])
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(2000)])

      expect(repository.listTimeframes(BTC_USDT)).toEqual([Timeframe.HOUR, Timeframe.FOUR_HOURS])
      expect(repository.listTimeframes(ETH_USDT)).toEqual([])
    })

    it('listInstruments devuelve los instrumentos con datos, ordenados', () => {
      repository.save(ETH_USDT, Timeframe.HOUR, [candle(1000)])
      repository.save(BTC_USDT, Timeframe.HOUR, [candle(2000)])

      expect(repository.listInstruments()).toEqual([BTC_USDT, ETH_USDT])
      expect(new CandleRepository(new MemoryStorage()).listInstruments()).toEqual([])
    })
  })

  describe('corrupción', () => {
    it('JSON inválido lanza CorruptedStorageError con name correcto', () => {
      storage.setItem(BTC_KEY, '{no es json')

      const error = catchError(() => repository.find(BTC_USDT, Timeframe.HOUR))

      expect(error).toBeInstanceOf(CorruptedStorageError)
      expect((error as Error).name).toBe('CorruptedStorageError')
    })

    it('JSON válido con velas inválidas lanza CorruptedStorageError', () => {
      storage.setItem(BTC_KEY, JSON.stringify([{ time: 'not_a_time' }]))

      expect(() => repository.find(BTC_USDT, Timeframe.HOUR)).toThrow(CorruptedStorageError)
    })
  })
})

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}
