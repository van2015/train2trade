import { describe, expect, it } from 'vitest'
import { Candle } from '@/domain/candles/candle'
import {
  CHART_COLORS,
  priceFormatFor,
  toCandlestickData,
  toChartTime,
  toEquityAreaData,
  toLineData,
  toVolumeData,
} from '@/components/chartData'

function candle(
  time: number,
  overrides: Partial<{ open: number; close: number; volume: number }> = {},
) {
  return Candle.from({
    time,
    open: overrides.open ?? 100,
    high: 110,
    low: 90,
    close: overrides.close ?? 105,
    volume: overrides.volume ?? 42,
  })
}

describe('toChartTime', () => {
  it('convierte milisegundos a segundos (UTCTimestamp)', () => {
    expect(toChartTime(1_700_000_000_000)).toBe(1_700_000_000)
  })

  it('redondea hacia abajo los milisegundos residuales', () => {
    expect(toChartTime(1_000_999)).toBe(1_000)
  })
})

describe('toCandlestickData', () => {
  it('mapea OHLC conservando el orden y el tiempo en segundos', () => {
    const data = toCandlestickData([candle(3_000), candle(1_000), candle(2_000)])

    expect(data).toEqual([
      { time: 3, open: 100, high: 110, low: 90, close: 105 },
      { time: 1, open: 100, high: 110, low: 90, close: 105 },
      { time: 2, open: 100, high: 110, low: 90, close: 105 },
    ])
  })

  it('devuelve una lista vacía sin velas', () => {
    expect(toCandlestickData([])).toEqual([])
  })
})

describe('toVolumeData', () => {
  it('colorea el volumen según la dirección de la vela', () => {
    const [bullish, bearish] = toVolumeData([
      candle(1_000, { close: 120 }),
      candle(2_000, { close: 80 }),
    ])

    expect(bullish?.color).toBe(CHART_COLORS.volumeUp)
    expect(bearish?.color).toBe(CHART_COLORS.volumeDown)
  })

  it('una vela plana (close === open) se considera bajista', () => {
    const [flat] = toVolumeData([candle(1_000, { open: 100, close: 100 })])

    expect(flat?.color).toBe(CHART_COLORS.volumeDown)
  })

  it('incluye el valor del volumen', () => {
    const [entry] = toVolumeData([candle(1_000, { volume: 123.45 })])

    expect(entry?.value).toBe(123.45)
  })
})

describe('toLineData', () => {
  it('mapea los valores numéricos a puntos con tiempo en segundos', () => {
    const data = toLineData([
      { time: 1_000, value: 10.5 },
      { time: 2_000, value: 11 },
    ])

    expect(data).toEqual([
      { time: 1, value: 10.5 },
      { time: 2, value: 11 },
    ])
  })

  it('convierte los null del calentamiento en datos en blanco (hueco en la línea)', () => {
    const data = toLineData([
      { time: 1_000, value: null },
      { time: 2_000, value: 5 },
    ])

    expect(data[0]).toEqual({ time: 1 })
    expect(data[0]).not.toHaveProperty('value')
    expect(data[1]).toEqual({ time: 2, value: 5 })
  })

  it('devuelve una lista vacía sin valores', () => {
    expect(toLineData([])).toEqual([])
  })
})

describe('priceFormatFor', () => {
  it('usa dos decimales para precios grandes', () => {
    expect(priceFormatFor(75_894.45)).toEqual({ precision: 2, minMove: 0.01 })
    expect(priceFormatFor(1_000)).toEqual({ precision: 2, minMove: 0.01 })
  })

  it('aumenta la precisión a medida que el precio baja', () => {
    expect(priceFormatFor(250.5)).toEqual({ precision: 4, minMove: 0.0001 })
    expect(priceFormatFor(0.5)).toEqual({ precision: 6, minMove: 0.000001 })
    expect(priceFormatFor(0.0000123)).toEqual({ precision: 8, minMove: 0.00000001 })
  })

  it('usa el valor absoluto (también funciona con precios negativos)', () => {
    expect(priceFormatFor(-5_000)).toEqual({ precision: 2, minMove: 0.01 })
  })
})

describe('toEquityAreaData', () => {
  it('convierte la curva de equity a datos de área (tiempo en segundos)', () => {
    const points = [
      { time: 1_700_000_000_000, equity: 1_234.5 },
      { time: 1_700_000_060_000, equity: 1_300 },
    ]
    expect(toEquityAreaData(points)).toEqual([
      { time: 1_700_000_000, value: 1_234.5 },
      { time: 1_700_000_060, value: 1_300 },
    ])
  })

  it('la curva vacía produce []', () => {
    expect(toEquityAreaData([])).toEqual([])
  })
})
