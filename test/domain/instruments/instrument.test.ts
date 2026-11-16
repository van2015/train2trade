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

    const INVALID: Array<[string, () => unknown]> = [
      ['string sin separador', () => Instrument.from('BTCUSDT')],
      ['más de dos partes', () => Instrument.from('BTC/USDT/ETH')],
      ['partes vacías', () => Instrument.from('/USDT')],
      ['quote vacía en el objeto', () => Instrument.from({ base: 'BTC', quote: '  ' })],
      ['caracteres no alfanuméricos (string)', () => Instrument.from('BT-C/USDT')],
      ['caracteres no alfanuméricos (partes)', () => Instrument.of('BT$C', 'USDT')],
      ['null', () => Instrument.from(null)],
      ['undefined', () => Instrument.from(undefined)],
      ['número', () => Instrument.from(42)],
      ['objeto sin quote', () => Instrument.from({ base: 'BTC' })],
    ]

    it.each(INVALID)('lanza InvalidInstrumentError con %s', (_label, build) => {
      expect(build).toThrow(InvalidInstrumentError)
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
