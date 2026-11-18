import { CandleChart } from '@/components/organisms/CandleChart'
import { TestForwardSessionView } from '@/components/organisms/TestForwardSessionView'
import type { ChartLine } from '@/components/utils/chartData'
import { Candle } from '@/domain/candles/candle'
import type { TestForwardSession } from '@/domain/testforward/session'

export interface TestForwardViewProps {
  active: boolean
  session: TestForwardSession | null
  /** Velas completas: si cambian, la sesión se descarta (patrón Replay). */
  candles: readonly Candle[]
  visible: readonly Candle[]
  lines: readonly ChartLine[]
  onProgress: (cursor: number | null) => void
}

/**
 * Pestaña Test-Forward: siempre montada (oculta fuera de su pestaña) para
 * conservar la sesión; el gráfico solo se monta mientras la pestaña está
 * activa (evita dos instancias de lightweight-charts), patrón Replay.
 */
export function TestForwardView({
  active,
  session,
  candles,
  visible,
  lines,
  onProgress,
}: TestForwardViewProps) {
  return (
    <div
      className="app__view app__view--replay"
      id={active ? 'main-view' : 'testforward-view'}
      role="tabpanel"
      aria-labelledby="main-tab-testforward"
      hidden={!active}
    >
      <TestForwardSessionView session={session} candles={candles} onProgress={onProgress} />
      {active && <CandleChart candles={visible} lines={lines} />}
    </div>
  )
}
