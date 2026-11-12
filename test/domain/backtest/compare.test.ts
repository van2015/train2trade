import { describe, expect, it } from 'vitest'
import { compareExperiments, ComparisonRow, rankBy } from '@/domain/backtest/compare'
import { ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'

const t0 = 1_700_000_000_000
const stepMs = 60_000

const BASE_METRICS: Metrics = {
  netProfit: 10,
  roi: 0.01,
  maxDrawdown: 0.02,
  sharpe: 1.5,
  profitFactor: 2,
  winRate: 0.5,
  avgTrade: 5,
  expectancy: 2.5,
}

function snapshot(overrides: Partial<ExperimentSnapshot> = {}): ExperimentSnapshot {
  return {
    id: 'aaa',
    strategyId: 'sma-cross@1',
    fingerprint: 'deadbeef',
    instrument: 'BTC/USDT',
    timeframe: '1h',
    period: { from: t0, to: t0 + 8 * stepMs },
    initialCapital: 1_000,
    execution: { slippageBps: 0, feeBps: 0 },
    risk: { maxPositionFraction: 1, minCashReserve: 0, feeBps: 0, slippageBps: 0 },
    metrics: { ...BASE_METRICS },
    finalEquity: 1_010,
    equityCurve: [{ time: t0, equity: 1_000 }],
    trades: [],
    ...overrides,
  }
}

function row(id: string, metrics: Partial<Metrics> = {}): ComparisonRow {
  const snap = snapshot({ id, metrics: { ...BASE_METRICS, ...metrics } })
  return {
    id: snap.id,
    strategyId: snap.strategyId,
    instrument: snap.instrument,
    timeframe: snap.timeframe,
    period: { ...snap.period },
    initialCapital: snap.initialCapital,
    metrics: snap.metrics,
    finalEquity: snap.finalEquity,
  }
}

describe('compareExperiments — tabla de comparación (§9)', () => {
  it('0 o 1 snapshot → differences vacío', () => {
    expect(compareExperiments([])).toEqual({ rows: [], differences: [] })

    const table = compareExperiments([snapshot()])
    expect(table.differences).toEqual([])
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toEqual({
      id: 'aaa',
      strategyId: 'sma-cross@1',
      instrument: 'BTC/USDT',
      timeframe: '1h',
      period: { from: t0, to: t0 + 8 * stepMs },
      initialCapital: 1_000,
      metrics: { ...BASE_METRICS },
      finalEquity: 1_010,
    })
  })

  it('≥2 snapshots → lista los campos que varían (orden estable)', () => {
    const table = compareExperiments([
      snapshot({ id: 'a' }),
      snapshot({
        id: 'b',
        instrument: 'ETH/USDT',
        timeframe: '4h',
        period: { from: t0 + 86_400_000, to: t0 + 90_000_000 },
        initialCapital: 2_000,
        execution: { slippageBps: 10, feeBps: 5 },
        risk: { maxPositionFraction: 0.5, minCashReserve: 0, feeBps: 5, slippageBps: 10 },
      }),
    ])

    expect(table.differences).toEqual([
      'instrument',
      'timeframe',
      'period',
      'initialCapital',
      'execution',
      'risk',
    ])
    expect(table.rows).toHaveLength(2)
  })

  it('solo los campos variados, en el orden del contrato', () => {
    const table = compareExperiments([
      snapshot({ id: 'a' }),
      snapshot({ id: 'b', timeframe: '4h', initialCapital: 500 }),
    ])

    expect(table.differences).toEqual(['timeframe', 'initialCapital'])
  })

  it('la estrategia NO es un campo de diferencia (compararla es el objeto)', () => {
    const table = compareExperiments([
      snapshot({ id: 'a', strategyId: 'alpha@1' }),
      snapshot({ id: 'b', strategyId: 'beta@2', fingerprint: 'cafebabe' }),
    ])

    expect(table.differences).toEqual([])
    expect(table.rows.map((item) => item.strategyId)).toEqual(['alpha@1', 'beta@2'])
  })

  it('determinismo: misma entrada → misma tabla', () => {
    const snapshots = [snapshot({ id: 'a' }), snapshot({ id: 'b', timeframe: '4h' })]
    expect(compareExperiments(snapshots)).toEqual(compareExperiments(snapshots))
  })
})

describe('rankBy — ranking por métrica (§9)', () => {
  it('ordena descendente por la métrica pedida', () => {
    const rows = [
      row('a', { netProfit: 10, roi: 0.1 }),
      row('b', { netProfit: 30, roi: 0.3 }),
      row('c', { netProfit: 20, roi: 0.2 }),
    ]

    expect(rankBy(rows, 'netProfit').map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(rankBy(rows, 'roi').map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('las métricas null van al final sin alterar el orden entre sí', () => {
    const rows = [
      row('a', { winRate: null }),
      row('b', { winRate: 0.6 }),
      row('c', { winRate: null }),
      row('d', { winRate: 0.2 }),
    ]

    expect(rankBy(rows, 'winRate').map((item) => item.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('empates estables: conservan el orden de entrada', () => {
    const rows = [
      row('a', { netProfit: 10 }),
      row('b', { netProfit: 10 }),
      row('c', { netProfit: 10 }),
    ]
    expect(rankBy(rows, 'netProfit').map((item) => item.id)).toEqual(['a', 'b', 'c'])

    const allNull = [
      row('a', { sharpe: null }),
      row('b', { sharpe: null }),
      row('c', { sharpe: null }),
    ]
    expect(rankBy(allNull, 'sharpe').map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('admite ±Infinity (sharpe con varianza cero) y no muta la entrada', () => {
    const rows = [
      row('a', { sharpe: 2 }),
      row('b', { sharpe: Number.POSITIVE_INFINITY }),
      row('c', { sharpe: Number.NEGATIVE_INFINITY }),
    ]
    const orderBefore = rows.map((item) => item.id)

    expect(rankBy(rows, 'sharpe').map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(rows.map((item) => item.id)).toEqual(orderBefore)
  })

  it('integración: ranking sobre las filas de compareExperiments', () => {
    const table = compareExperiments([
      snapshot({ id: 'low', metrics: { ...BASE_METRICS, roi: -0.1 } }),
      snapshot({ id: 'high', metrics: { ...BASE_METRICS, roi: 0.4 } }),
      snapshot({ id: 'mid', metrics: { ...BASE_METRICS, roi: 0.2 } }),
    ])

    expect(rankBy(table.rows, 'roi').map((item) => item.id)).toEqual(['high', 'mid', 'low'])
  })
})
