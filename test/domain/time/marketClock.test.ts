import { describe, expect, it } from 'vitest'
import { MarketClock, MarketClockError } from '@/domain/time/marketClock'

const t0 = 1_700_000_000_000
const step = 60_000

describe('MarketClock — construcción', () => {
  it('arranca sin tiempo: now es null', () => {
    expect(new MarketClock().now).toBeNull()
  })
})

describe('MarketClock — advanceTo', () => {
  it('el primer avance fija el tiempo', () => {
    const clock = new MarketClock()
    clock.advanceTo(t0)
    expect(clock.now).toBe(t0)
  })

  it('acepta el tiempo 0 (época) y avances estrictamente crecientes', () => {
    const clock = new MarketClock()
    clock.advanceTo(0)
    expect(clock.now).toBe(0)
    clock.advanceTo(t0)
    clock.advanceTo(t0 + step)
    expect(clock.now).toBe(t0 + step)
  })

  it('rechaza repetir el mismo tiempo (no es estrictamente creciente)', () => {
    const clock = new MarketClock()
    clock.advanceTo(t0)
    expect(() => clock.advanceTo(t0)).toThrow(MarketClockError)
    expect(clock.now).toBe(t0)
  })

  it('rechaza retroceder', () => {
    const clock = new MarketClock()
    clock.advanceTo(t0 + step)
    expect(() => clock.advanceTo(t0)).toThrow(MarketClockError)
    expect(clock.now).toBe(t0 + step) // el estado no cambia
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negativo', -1],
    ['no number', 'ayer'],
  ] as const)('rechaza un tiempo %s con MarketClockError', (_label, time) => {
    expect(() => new MarketClock().advanceTo(time as unknown as number)).toThrow(MarketClockError)
  })

  it('el primer avance inválido deja el reloj sin tiempo', () => {
    const clock = new MarketClock()
    expect(() => clock.advanceTo(-5)).toThrow(MarketClockError)
    expect(clock.now).toBeNull()
  })

  it('el error fija this.name y formatea el valor recibido', () => {
    try {
      new MarketClock().advanceTo(-1)
      expect.unreachable('debería lanzar MarketClockError')
    } catch (error) {
      expect(error).toBeInstanceOf(MarketClockError)
      expect((error as MarketClockError).name).toBe('MarketClockError')
      expect((error as MarketClockError).message).toContain('(recibido: -1)')
    }
  })
})

describe('MarketClock — determinismo (§12A)', () => {
  it('el mismo script de avances produce los mismos estados, sin leer el reloj del sistema', () => {
    const script = [t0, t0 + step, t0 + 2 * step]
    const first = new MarketClock()
    const second = new MarketClock()
    for (const time of script) {
      first.advanceTo(time)
      second.advanceTo(time)
    }
    expect(second.now).toBe(first.now)
    expect(first.now).toBe(script[script.length - 1])
  })
})
