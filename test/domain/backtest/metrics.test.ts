import { describe, expect, it } from 'vitest'
import { Trade } from '@/domain/backtest/trade'
import {
  avgTrade,
  computeMetrics,
  EquityPoint,
  expectancy,
  maxDrawdown,
  MetricsError,
  MetricsInput,
  netProfit,
  profitFactor,
  roi,
  sharpe,
  winRate,
} from '@/domain/backtest/metrics'
import { Timeframe } from '@/domain/candles/timeframe'

const t0 = 1_700_000_000_000
const step = 60_000

function equityCurve(...values: number[]): EquityPoint[] {
  return values.map((equity, index) => ({ time: t0 + index * step, equity }))
}

function trade(pnl: number): Trade {
  return new Trade({
    entryTime: t0,
    entryPrice: 100,
    exitTime: t0 + step,
    exitPrice: 100 + pnl, // qty 1 → exitPrice = entry + pnl
    qty: 1,
    pnl,
    fees: 0,
  })
}

function input(overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    trades: [],
    equityCurve: equityCurve(1_000),
    initialCapital: 1_000,
    timeframe: Timeframe.HOUR,
    ...overrides,
  }
}

describe('metrics — netProfit y roi', () => {
  it('netProfit es la diferencia entre el equity final y el inicial', () => {
    expect(netProfit(equityCurve(1_000, 1_150), 1_000)).toBe(150)
    expect(netProfit(equityCurve(1_000, 900), 1_000)).toBe(-100)
    expect(netProfit(equityCurve(1_000), 1_000)).toBe(0)
  })

  it('roi es netProfit sobre el capital inicial', () => {
    expect(roi(equityCurve(1_000, 1_150), 1_000)).toBeCloseTo(0.15, 10)
    expect(roi(equityCurve(1_000, 500), 1_000)).toBeCloseTo(-0.5, 10)
  })

  it('la curva vacía o un capital inválido son errores de dominio', () => {
    expect(() => netProfit([], 1_000)).toThrow(MetricsError)
    expect(() => netProfit(equityCurve(1_000), 0)).toThrow(MetricsError)
    expect(() => roi(equityCurve(1_000), Number.NaN)).toThrow(MetricsError)
  })
})

describe('metrics — maxDrawdown', () => {
  it('es la máxima caída desde un pico, como fracción', () => {
    // pico 1200 → valle 900 = 25%
    expect(maxDrawdown(equityCurve(1_000, 1_200, 900, 1_300))).toBeCloseTo(0.25, 10)
    expect(maxDrawdown(equityCurve(1_000, 1_100, 1_200))).toBe(0) // sin caídas
    expect(maxDrawdown(equityCurve(1_000))).toBe(0) // un solo punto
  })

  it('la curva vacía es un error de dominio', () => {
    expect(() => maxDrawdown([])).toThrow(MetricsError)
  })
})

describe('metrics — sharpe', () => {
  it('null con menos de 2 retornos o equity plano (sin variación)', () => {
    expect(sharpe(equityCurve(1_000), Timeframe.HOUR)).toBeNull()
    expect(sharpe(equityCurve(1_000, 1_000, 1_000), Timeframe.HOUR)).toBeNull()
  })

  it('media/desv de retornos anualizada con el timeframe (365 días, sin riesgo libre)', () => {
    // retornos: +10% y -5% → media 0.025, desv muestral sqrt(0.01125)
    const curve = equityCurve(1_000, 1_100, 1_045)
    const expected = (0.025 / Math.sqrt(0.01125)) * Math.sqrt(365) // timeframe 1d
    expect(sharpe(curve, Timeframe.DAY)).toBeCloseTo(expected, 10)
    expect(sharpe(curve, Timeframe.DAY)).toBeGreaterThan(0)
  })

  it('serie descendente → sharpe negativo; constante → ±∞', () => {
    expect(sharpe(equityCurve(1_000, 900, 810), Timeframe.DAY)).toBeLessThan(0)
    expect(sharpe(equityCurve(1_000, 1_100, 1_210), Timeframe.DAY)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('metrics — profitFactor', () => {
  it('ganancias totales sobre pérdidas totales en valor absoluto', () => {
    expect(profitFactor([trade(10), trade(-5), trade(20)])).toBeCloseTo(30 / 5, 10)
  })

  it('sin pérdidas → null; sin ganancias con pérdidas → 0; sin trades → null', () => {
    expect(profitFactor([trade(10), trade(20)])).toBeNull()
    expect(profitFactor([trade(-5), trade(-10)])).toBe(0)
    expect(profitFactor([])).toBeNull()
  })
})

describe('metrics — winRate, avgTrade y expectancy', () => {
  it('winRate es la fracción de trades con pnl > 0 (el empate no gana)', () => {
    expect(winRate([trade(10), trade(-5), trade(20)])).toBeCloseTo(2 / 3, 10)
    expect(winRate([trade(0), trade(10)])).toBeCloseTo(0.5, 10)
    expect(winRate([])).toBeNull()
  })

  it('avgTrade es la media de pnl', () => {
    expect(avgTrade([trade(10), trade(-5), trade(20)])).toBeCloseTo(25 / 3, 10)
    expect(avgTrade([])).toBeNull()
  })

  it('expectancy = wr*avgWin - lossRate*avgLoss (identidad con avgTrade en mismos trades)', () => {
    const trades = [trade(10), trade(-20), trade(30), trade(-10)]
    const expected = (2 / 4) * 20 - (2 / 4) * 15 // 0.5*20 - 0.5*15 = 2.5
    expect(expectancy(trades)).toBeCloseTo(expected, 10)
    expect(expectancy(trades)).toBeCloseTo(avgTrade(trades) ?? Number.NaN, 10)
    expect(expectancy([])).toBeNull()
    expect(expectancy([trade(-5)])).toBeCloseTo(-5, 10)
  })
})

describe('metrics — computeMetrics', () => {
  it('agrega las 8 métricas con la config dada', () => {
    const metrics = computeMetrics(
      input({
        trades: [trade(50), trade(-30)],
        equityCurve: equityCurve(1_000, 1_050, 1_020),
        timeframe: Timeframe.HOUR,
      }),
    )

    expect(metrics.netProfit).toBe(20)
    expect(metrics.roi).toBeCloseTo(0.02, 10)
    expect(metrics.maxDrawdown).toBeCloseTo(1 - 1_020 / 1_050, 10)
    expect(metrics.sharpe).not.toBeNull()
    expect(metrics.profitFactor).toBeCloseTo(50 / 30, 10)
    expect(metrics.winRate).toBeCloseTo(0.5, 10)
    expect(metrics.avgTrade).toBeCloseTo(10, 10)
    expect(metrics.expectancy).toBeCloseTo(10, 10)
  })

  it('trades vacíos → las métricas de trades son null, las de equity siguen calculándose', () => {
    const metrics = computeMetrics(input())
    expect(metrics.winRate).toBeNull()
    expect(metrics.avgTrade).toBeNull()
    expect(metrics.expectancy).toBeNull()
    expect(metrics.profitFactor).toBeNull()
    expect(metrics.netProfit).toBe(0)
    expect(metrics.maxDrawdown).toBe(0)
  })

  it('valida la entrada (curva vacía, capital y timeframe inválidos)', () => {
    expect(() => computeMetrics(input({ equityCurve: [] }))).toThrow(MetricsError)
    expect(() => computeMetrics(input({ initialCapital: -1 }))).toThrow(MetricsError)
    expect(() => computeMetrics(input({ timeframe: '1h' as unknown as Timeframe }))).toThrow(
      MetricsError,
    )
  })
})
