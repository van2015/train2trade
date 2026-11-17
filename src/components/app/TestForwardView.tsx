import { CandleChart } from '@/components/CandleChart'
import { TestForwardSessionView } from '@/components/TestForwardSessionView'
import type { ChartLine } from '@/components/chartData'
import { Candle } from '@/domain/candles/candle'
import type { TestForwardSession } from '@/domain/testforward/session'

export interface TestForwardViewProps {
  /** true → pestaña Test-Forward activa (el chart solo se monta entonces). */
  active: boolean
  /** Sesión iniciada desde el sidebar; null = aún no hay (§2.3). */
  session: TestForwardSession | null
  /** Velas completas: si cambian, la sesión se descarta (patrón Replay). */
  candles: readonly Candle[]
  /** Velas recortadas al cursor: el chart solo ve lo consumido. */
  visible: readonly Candle[]
  lines: readonly ChartLine[]
  /** Cursor tras cada acción (o null al descartar): App recorta el gráfico. */
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
