import { Candle } from '@/domain/candles/candle'
import { IndicatorValue } from '@/domain/indicators/indicator'
import { MarketContext } from '@/domain/strategies/marketContext'

/**
 * Contexto de evaluación sobre `candles` con las series indicadas alineadas
 * (`values[i]` ↔ vela `i`; huecos → `null`). Los tests pasan sus propias velas.
 */
export function contextWith(
  candles: readonly Candle[],
  indicators: Record<string, (number | null)[]>,
): MarketContext {
  const series: Record<string, IndicatorValue[]> = {}
  for (const [id, values] of Object.entries(indicators)) {
    series[id] = candles.map((entry, index) => ({ time: entry.time, value: values[index] ?? null }))
  }
  return MarketContext.from({ candles, indicators: series })
}
