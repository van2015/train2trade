import { Timeframe } from '@/domain/candles/timeframe'
import { Trade } from '@/domain/backtest/trade'
import { DomainError, invalidMessage } from '@/domain/errors'

/** Un punto de la curva de equity: un cierre de vela (ms UTC + equity marcado). */
export interface EquityPoint {
  time: number
  equity: number
}

/** §9 — conjunto mínimo acordado para la Fase 4. `null` = no aplica (se muestra "—"). */
export interface Metrics {
  netProfit: number
  roi: number
  maxDrawdown: number
  sharpe: number | null
  profitFactor: number | null
  winRate: number | null
  avgTrade: number | null
  expectancy: number | null
}

export interface MetricsInput {
  trades: readonly Trade[]
  equityCurve: readonly EquityPoint[]
  initialCapital: number
  /** Para la anualización del Sharpe (§12C: el timeframe queda registrado en el experimento). */
  timeframe: Timeframe
}

export class MetricsError extends DomainError {
  constructor(reason: string, raw?: unknown) {
    super('MetricsError', invalidMessage('Métricas inválidas', reason, raw))
  }
}

/** Crypto 24/7: año de 365 días en ms (la anualización usa el timeframe real). */
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1_000

export function netProfit(curve: readonly EquityPoint[], initialCapital: number): number {
  assertCapital(initialCapital)
  return lastPoint(curve).equity - initialCapital
}

export function roi(curve: readonly EquityPoint[], initialCapital: number): number {
  return netProfit(curve, initialCapital) / initialCapital
}

/** Máxima caída desde un pico como fracción en [0, 1]; 0 si no hay caídas. */
export function maxDrawdown(curve: readonly EquityPoint[]): number {
  assertCurve(curve)
  let peak = firstPoint(curve).equity
  let worst = 0
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity
    if (peak <= 0) continue
    const drawdown = 1 - point.equity / peak
    if (drawdown > worst) worst = drawdown
  }
  return worst
}

/**
 * Sharpe sin riesgo libre: retornos por vela (equity[i]/equity[i-1] − 1),
 * media / desviation **muestral** (n−1), anualizada con
 * `√(añoMs / timeframe.ms)`. `null` si hay menos de 2 retornos válidos o el
 * equity es plano (media y desv 0); con desv 0 y media ≠ 0 → ±∞ (crecimiento
 * o caída constantes). Asume velas contiguas (sin huecos).
 */
export function sharpe(curve: readonly EquityPoint[], timeframe: Timeframe): number | null {
  assertCurve(curve)
  assertTimeframe(timeframe)

  const returns: number[] = []
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1]
    const current = curve[index]
    if (previous === undefined || current === undefined || previous.equity <= 0) continue
    const value = current.equity / previous.equity - 1
    if (Number.isFinite(value)) returns.push(value)
  }
  if (returns.length < 2) return null

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
  const std = Math.sqrt(variance)
  if (std === 0) {
    // Sin varianza: crecimiento/caída constantes → ±∞; plano → no definible.
    return mean === 0 ? null : Math.sign(mean) * Number.POSITIVE_INFINITY
  }

  return (mean / std) * Math.sqrt(MS_PER_YEAR / timeframe.ms)
}

/** ∑ganancias / ∑pérdidas (absolutas). Sin pérdidas → `null`; sin trades → `null`. */
export function profitFactor(trades: readonly Trade[]): number | null {
  let gains = 0
  let losses = 0
  for (const trade of trades) {
    if (trade.pnl > 0) gains += trade.pnl
    else if (trade.pnl < 0) losses += -trade.pnl
  }
  if (losses === 0) return null
  return gains / losses
}

/** Fracción de trades cerrados con pnl > 0 (el empate no gana). Sin trades → `null`. */
export function winRate(trades: readonly Trade[]): number | null {
  if (trades.length === 0) return null
  const wins = trades.filter((trade) => trade.win).length
  return wins / trades.length
}

/** Media de pnl por trade cerrado. Sin trades → `null`. */
export function avgTrade(trades: readonly Trade[]): number | null {
  if (trades.length === 0) return null
  const total = trades.reduce((sum, trade) => sum + trade.pnl, 0)
  return total / trades.length
}

/**
 * `wr * avgWin − lossRate * avgLoss`. Con el mismo conjunto de trades vale lo
 * que `avgTrade` (identidad algebraica: es la media de pnl); se mantiene por
 * claridad semántica respecto a §9.
 */
export function expectancy(trades: readonly Trade[]): number | null {
  if (trades.length === 0) return null
  const wins = trades.filter((trade) => trade.pnl > 0)
  const losses = trades.filter((trade) => trade.pnl < 0)
  const winRatio = wins.length / trades.length
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + -t.pnl, 0) / losses.length : 0
  return winRatio * avgWin - (1 - winRatio) * avgLoss
}

/** Agrega las 8 métricas validando la entrada (§9). */
export function computeMetrics(input: MetricsInput): Metrics {
  const { trades, equityCurve, initialCapital, timeframe } = input
  assertCurve(equityCurve)
  assertCapital(initialCapital)
  assertTimeframe(timeframe)

  return {
    netProfit: netProfit(equityCurve, initialCapital),
    roi: roi(equityCurve, initialCapital),
    maxDrawdown: maxDrawdown(equityCurve),
    sharpe: sharpe(equityCurve, timeframe),
    profitFactor: profitFactor(trades),
    winRate: winRate(trades),
    avgTrade: avgTrade(trades),
    expectancy: expectancy(trades),
  }
}

function assertCurve(curve: readonly EquityPoint[]): void {
  if (curve.length === 0) {
    throw new MetricsError('el equityCurve no puede estar vacío', curve.length)
  }
}

function assertCapital(initialCapital: number): void {
  if (
    typeof initialCapital !== 'number' ||
    !Number.isFinite(initialCapital) ||
    initialCapital <= 0
  ) {
    throw new MetricsError('initialCapital debe ser un número finito > 0', initialCapital)
  }
}

function assertTimeframe(timeframe: Timeframe): void {
  if (!(timeframe instanceof Timeframe)) {
    throw new MetricsError('timeframe debe ser un Timeframe', timeframe)
  }
}

function firstPoint(curve: readonly EquityPoint[]): EquityPoint {
  const first = curve[0]
  if (first === undefined) throw new MetricsError('el equityCurve no puede estar vacío', 0)
  return first
}

function lastPoint(curve: readonly EquityPoint[]): EquityPoint {
  const last = curve[curve.length - 1]
  if (last === undefined) throw new MetricsError('el equityCurve no puede estar vacío', 0)
  return last
}

/**
 * Ordena descendente por `metric`: `null` al final y **empates estables**
 * (conservan el orden de entrada). No muta la entrada. Es la semántica única
 * del ranking: la usan `rankBy` (comparación) y los `best`/`worst` de la
 * optimización, con lo que ambos quedan coherentes por construcción.
 */
export function sortByMetricDesc<T extends { metrics: Metrics }>(
  items: readonly T[],
  metric: keyof Metrics,
): readonly T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const before = a.item.metrics[metric]
      const after = b.item.metrics[metric]

      if (before === null && after === null) return a.index - b.index
      if (before === null) return 1 // nulls al final
      if (after === null) return -1
      if (before === after) return a.index - b.index // empate → orden de entrada
      return after - before // descendente
    })
    .map(({ item }) => item)
}
