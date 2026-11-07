import { Instrument, InvalidInstrumentError } from '@/domain/instruments/instrument'

describe('Instrument', () => {
  describe('from', () => {
    it('parsea el string canónico "BTC/USDT"', () => {
      const instrument = Instrument.from('BTC/USDT')

      expect(instrument.base).toBe('BTC')
      expect(instrument.quote).toBe('USDT')
    })

    it('normaliza espacios y minúsculas: " btc / usdt " → BTC/USDT', () => {
      const instrument = Instrument.from(' btc / usdt ')

      expect(instrument.base).toBe('BTC')
      expect(instrument.quote).toBe('USDT')
    })

    it('acepta un objeto { base, quote }', () => {
      expect(Instrument.from({ base: 'BTC', quote: 'USDT' })).toEqual(Instrument.of('BTC', 'USDT'))
    })

    it('es idempotente sobre instancias', () => {
      const instrument = Instrument.of('BTC', 'USDT')

      expect(Instrument.from(instrument)).toBe(instrument)
    })

    it('acepta un par sin separador en el objeto', () => {
      expect(Instrument.from({ base: ' eth ', quote: 'usdc' })).toEqual(
        Instrument.of('ETH', 'USDC'),
      )
    })

    it('lanza InvalidInstrumentError con un string sin separador', () => {
      expect(() => Instrument.from('BTCUSDT')).toThrow(InvalidInstrumentError)
    })

    it('lanza InvalidInstrumentError con más de dos partes', () => {
      expect(() => Instrument.from('BTC/USDT/ETH')).toThrow(InvalidInstrumentError)
    })

    it('lanza InvalidInstrumentError con partes vacías', () => {
      expect(() => Instrument.from('/USDT')).toThrow(InvalidInstrumentError)
      expect(() => Instrument.from({ base: 'BTC', quote: '  ' })).toThrow(InvalidInstrumentError)
    })

    it('lanza InvalidInstrumentError con caracteres no alfanuméricos', () => {
      expect(() => Instrument.from('BT-C/USDT')).toThrow(InvalidInstrumentError)
      expect(() => Instrument.of('BT$C', 'USDT')).toThrow(InvalidInstrumentError)
    })

    it('lanza InvalidInstrumentError con valores que no son string ni objeto', () => {
      expect(() => Instrument.from(null)).toThrow(InvalidInstrumentError)
      expect(() => Instrument.from(undefined)).toThrow(InvalidInstrumentError)
      expect(() => Instrument.from(42)).toThrow(InvalidInstrumentError)
      expect(() => Instrument.from({ base: 'BTC' })).toThrow(InvalidInstrumentError)
    })

    it('el error tiene name InvalidInstrumentError', () => {
      try {
        Instrument.from('BTCUSDT')
        throw new Error('debía lanzar InvalidInstrumentError')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInstrumentError)
        expect((error as Error).name).toBe('InvalidInstrumentError')
      }
    })
  })

  describe('of', () => {
    it('construye desde las partes separadas', () => {
      const instrument = Instrument.of('BTC', 'USDT')

      expect(instrument.base).toBe('BTC')
      expect(instrument.quote).toBe('USDT')
    })

    it('normaliza a mayúsculas', () => {
      expect(Instrument.of('btc', 'usdt').toString()).toBe('BTC/USDT')
    })
  })

  describe('is', () => {
    it('true solo para instancias de Instrument', () => {
      expect(Instrument.is(Instrument.of('BTC', 'USDT'))).toBe(true)
      expect(Instrument.is('BTC/USDT')).toBe(false)
      expect(Instrument.is(null)).toBe(false)
    })
  })

  describe('isValid', () => {
    it('true para formas válidas sin lanzar', () => {
      expect(Instrument.isValid('BTC/USDT')).toBe(true)
      expect(Instrument.isValid({ base: 'BTC', quote: 'USDT' })).toBe(true)
      expect(Instrument.isValid(Instrument.of('BTC', 'USDT'))).toBe(true)
    })

    it('false para formas inválidas', () => {
      expect(Instrument.isValid('BTCUSDT')).toBe(false)
      expect(Instrument.isValid('/')).toBe(false)
      expect(Instrument.isValid({ base: 'BTC' })).toBe(false)
      expect(Instrument.isValid(null)).toBe(false)
      expect(Instrument.isValid(42)).toBe(false)
    })
  })

  describe('exchangeSymbol', () => {
    it('concatena base y quote sin separador', () => {
      expect(Instrument.of('BTC', 'USDT').exchangeSymbol).toBe('BTCUSDT')
      expect(Instrument.of('1000PEPE', 'USDT').exchangeSymbol).toBe('1000PEPEUSDT')
    })
  })

  describe('equals', () => {
    it('true para el mismo valor', () => {
      expect(Instrument.of('BTC', 'USDT').equals(Instrument.of('BTC', 'USDT'))).toBe(true)
    })

    it('false para valores distintos', () => {
      expect(Instrument.of('BTC', 'USDT').equals(Instrument.of('ETH', 'USDT'))).toBe(false)
    })
  })

  describe('serialización', () => {
    it('toString y toJSON devuelven "BTC/USDT"', () => {
      const instrument = Instrument.of('BTC', 'USDT')

      expect(instrument.toString()).toBe('BTC/USDT')
      expect(instrument.toJSON()).toBe('BTC/USDT')
    })

    it('round-trip por JSON mantiene el valor', () => {
      const instrument = Instrument.of('BTC', 'USDT')
      const revived = Instrument.from(JSON.parse(JSON.stringify(instrument)))

      expect(revived).toBe(instrument)
      expect(revived.equals(instrument)).toBe(true)
    })
  })
})
