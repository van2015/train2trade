import { CandleChart } from '@/components/CandleChart'
import { ReplayPanel } from '@/components/ReplayPanel'
import type { ChartLine } from '@/components/chartData'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import type { StrategySpec } from '@/domain/strategies/spec'

export interface ReplayViewProps {
  /** true → pestaña Replay activa (el chart solo se monta entonces). */
  active: boolean
  /** Velas completas: el panel las reproduce desde el principio. */
  candles: readonly Candle[]
  /** Velas recortadas al cursor: el chart solo ve lo consumido. */
  visible: readonly Candle[]
  lines: readonly ChartLine[]
  timeframe: Timeframe
  strategy: StrategySpec | null
  /** Cursor tras cada avance (o null al descartar): App recorta el gráfico. */
  onProgress: (cursor: number | null) => void
}

/**
 * Pestaña Replay: siempre montada (oculta fuera de su pestaña) para no perder
 * la sesión; el gráfico solo se monta mientras la pestaña está activa (evita
 * dos instancias de lightweight-charts).
 */
export function ReplayView({
  active,
  candles,
  visible,
  lines,
  timeframe,
  strategy,
  onProgress,
}: ReplayViewProps) {
  return (
    <div
      className="app__view app__view--replay"
      id={active ? 'main-view' : 'replay-view'}
      role="tabpanel"
      aria-labelledby="main-tab-replay"
      hidden={!active}
    >
      <ReplayPanel
        candles={candles}
        timeframe={timeframe}
        strategy={strategy}
        onProgress={onProgress}
      />
      {active && <CandleChart candles={visible} lines={lines} />}
    </div>
  )
}
