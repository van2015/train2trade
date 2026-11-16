import { describe, expect, it } from 'vitest'
import { Ema } from '@/domain/indicators/ema'
import { candlesFrom } from '../../support/candles'

function values(period: number, closes: number[]): (number | null)[] {
  return new Ema(period).calculate(candlesFrom(closes)).map((entry) => entry.value)
}

describe('Ema', () => {
  it('siembra con la SMA de los primeros period cierres y aplica k = 2/(period+1)', () => {
    // period 3 → k = 0.5: semilla = media(2,4,6) = 4; luego 8*.5+4*.5=6, 10*.5+6*.5=8, 12*.5+8*.5=10
    expect(values(3, [2, 4, 6, 8, 10, 12])).toEqual([null, null, 4, 6, 8, 10])
  })

  it('Ema(1) es idéntica a la serie de cierres (k = 1)', () => {
    expect(values(1, [3, 1, 4])).toEqual([3, 1, 4])
  })
})
