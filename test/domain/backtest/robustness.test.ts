import { describe, expect, it } from 'vitest'
import { Metrics } from '@/domain/backtest/metrics'
import { OptimizationResult, OptimizationRun } from '@/domain/backtest/optimization'
import { analyzeRobustness, RobustnessError } from '@/domain/backtest/robustness'

const BASE_METRICS: Metrics = {
  netProfit: 0,
  roi: 0,
  maxDrawdown: 0,
  sharpe: null,
  profitFactor: null,
  winRate: null,
  avgTrade: null,
  expectancy: null,
}

function run(params: Record<string, number>, sharpe: number | null): OptimizationRun {
  return {
    params,
    metrics: { ...BASE_METRICS, sharpe },
    finalEquity: 1_000 + (sharpe ?? 0),
    tradeCount: sharpe === null ? 0 : 1,
  }
}

function result(
  runs: OptimizationRun[],
  grid: Record<string, readonly number[]>,
  metric: keyof Metrics = 'sharpe',
): OptimizationResult {
  const first = runs[0]
  const last = runs[runs.length - 1]
  if (first === undefined || last === undefined) throw new Error('runs vacío')
  return { grid, metric, runs, best: first, worst: last }
}

describe('analyzeRobustness — estadísticas sobre runs válidos (§13)', () => {
  it('count excluye los null; best/worst/mean/stdev sobre los no null', () => {
    const report = analyzeRobustness(
      result([run({ a: 1 }, 10), run({ a: 2 }, 30), run({ a: 3 }, null)], { a: [1, 2, 3] }),
    )

    expect(report.metric).toBe('sharpe')
    expect(report.count).toBe(2)
    expect(report.best).toBe(30)
    expect(report.worst).toBe(10)
    expect(report.mean).toBe(20)
    expect(report.stdev).toBeCloseTo(Math.sqrt(200), 10) // desv. muestral (n − 1)
  })

  it('sin ninguna métrica no null → RobustnessError', () => {
    try {
      analyzeRobustness(result([run({ a: 1 }, null)], { a: [1] }))
      expect.unreachable('debería lanzar RobustnessError')
    } catch (error) {
      expect(error).toBeInstanceOf(RobustnessError)
      expect((error as RobustnessError).name).toBe('RobustnessError')
    }
  })

  it('un solo run válido → stdev 0 y plateau sin vecinos', () => {
    const report = analyzeRobustness(result([run({ a: 1 }, 42)], { a: [1] }))

    expect(report.count).toBe(1)
    expect(report.mean).toBe(42)
    expect(report.stdev).toBe(0)
    expect(report.plateau).toEqual({ neighbors: 0, avg: null, worst: null })
  })
})

describe('analyzeRobustness — plateau (vecindario ±1 paso)', () => {
  it('esquina: exactamente un vecino por dimensión', () => {
    const report = analyzeRobustness(
      result(
        [
          run({ fast: 1, slow: 10 }, 40), // mejor en la esquina mínima
          run({ fast: 1, slow: 20 }, 10),
          run({ fast: 2, slow: 10 }, 20),
          run({ fast: 2, slow: 20 }, 30),
        ],
        { fast: [1, 2], slow: [10, 20] },
      ),
    )

    expect(report.plateau).toEqual({ neighbors: 2, avg: 15, worst: 10 })
  })

  it('rejilla 1×N: menos vecinos en los bordes', () => {
    const edge = analyzeRobustness(
      result([run({ a: 1 }, 30), run({ a: 2 }, 10), run({ a: 3 }, 20)], { a: [1, 2, 3] }),
    )
    expect(edge.plateau).toEqual({ neighbors: 1, avg: 10, worst: 10 })
    expect(edge.sensitivity).toEqual([{ param: 'a', spread: 20 }]) // medias 30/10/20

    const middle = analyzeRobustness(
      result([run({ a: 1 }, 10), run({ a: 2 }, 30), run({ a: 3 }, 20)], { a: [1, 2, 3] }),
    )
    expect(middle.plateau).toEqual({ neighbors: 2, avg: 15, worst: 10 })
  })

  it('los nulls se excluyen de las estadísticas pero cuentan en neighbors', () => {
    const report = analyzeRobustness(
      result(
        [
          run({ fast: 1, slow: 10 }, 10),
          run({ fast: 1, slow: 20 }, null), // vecino nulo del mejor
          run({ fast: 2, slow: 10 }, 20),
          run({ fast: 2, slow: 20 }, 40), // mejor
        ],
        { fast: [1, 2], slow: [10, 20] },
      ),
    )

    expect(report.count).toBe(3)
    expect(report.plateau).toEqual({ neighbors: 2, avg: 20, worst: 20 })
  })
})

describe('analyzeRobustness — umbral y sensibilidad (§13)', () => {
  it('aboveThreshold: umbral literal (>) y fracción sobre el total de ejecuciones', () => {
    const mixed = result(
      [run({ a: 1 }, 10), run({ a: 2 }, 30), run({ a: 3 }, null), run({ a: 4 }, 40)],
      { a: [1, 2, 3, 4] },
    )
    expect(analyzeRobustness(mixed, { threshold: 25 }).aboveThreshold).toEqual({
      threshold: 25,
      count: 2,
      fraction: 0.5, // 2 de 4 ejecuciones (el null no supera el umbral)
    })

    // por defecto 0; el igual al umbral NO cuenta (estrictamente >)
    expect(
      analyzeRobustness(result([run({ a: 1 }, -5), run({ a: 2 }, 10)], { a: [1, 2] }))
        .aboveThreshold,
    ).toEqual({ threshold: 0, count: 1, fraction: 0.5 })
    expect(
      analyzeRobustness(result([run({ a: 1 }, 25)], { a: [1] }), { threshold: 25 }).aboveThreshold
        .count,
    ).toBe(0)

    expect(() =>
      analyzeRobustness(result([run({ a: 1 }, 1)], { a: [1] }), { threshold: Number.NaN }),
    ).toThrow(RobustnessError)
  })

  it('sensitivity: media por valor fijando la dimensión, spread descendente', () => {
    const report = analyzeRobustness(
      result(
        [
          run({ fast: 1, slow: 10 }, 10),
          run({ fast: 1, slow: 20 }, 30),
          run({ fast: 2, slow: 10 }, 20),
          run({ fast: 2, slow: 20 }, 40),
        ],
        { fast: [1, 2], slow: [10, 20] },
      ),
    )

    expect(report.sensitivity).toEqual([
      { param: 'slow', spread: 20 }, // medias 15 y 35
      { param: 'fast', spread: 10 }, // medias 20 y 30
    ])
  })

  it('empates de spread → orden de declaración de la rejilla (determinismo)', () => {
    const report = analyzeRobustness(
      result(
        [
          run({ x: 1, y: 1 }, 10),
          run({ x: 1, y: 2 }, 30),
          run({ x: 2, y: 1 }, 30),
          run({ x: 2, y: 2 }, 10),
        ],
        { x: [1, 2], y: [1, 2] },
      ),
    )

    expect(report.sensitivity).toEqual([
      { param: 'x', spread: 0 },
      { param: 'y', spread: 0 },
    ])
  })

  it('determinismo: mismo input → mismo informe', () => {
    const input = result(
      [run({ a: 1 }, 10), run({ a: 2 }, 30), run({ a: 3 }, null)],
      { a: [1, 2, 3] },
      'sharpe',
    )
    expect(analyzeRobustness(input)).toEqual(analyzeRobustness(input))
  })
})
