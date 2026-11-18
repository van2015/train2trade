import { CandleChart } from '@/components/organisms/CandleChart'
import { StrategyPreviewChart } from '@/components/organisms/StrategyPreviewChart'
import type { ChartLine } from '@/components/utils/chartData'
import { Candle } from '@/domain/candles/candle'
import type { StrategySpec } from '@/domain/strategies/spec'

export interface ChartViewProps {
  active: boolean
  /** Velas ya recortadas por la sesión activa (§7B/§2.3): el chart no ve el futuro. */
  candles: readonly Candle[]
  lines: readonly ChartLine[]
  editingSpec: StrategySpec | null
}

/**
 * Pestaña Gráfico (plan strategy-preview, ampliación): con el editor de
 * estrategias abierto muestra el preview en lugar del chart normal — se
 * sustituyen, nunca conviven dos instancias de lightweight-charts.
 */
export function ChartView({ active, candles, lines, editingSpec }: ChartViewProps) {
  if (!active) return null

  return (
    <div className="app__view" id="main-view" role="tabpanel" aria-labelledby="main-tab-chart">
      {editingSpec !== null ? (
        <StrategyPreviewChart candles={candles} spec={editingSpec} />
      ) : (
        <CandleChart candles={candles} lines={lines} />
      )}
    </div>
  )
}
