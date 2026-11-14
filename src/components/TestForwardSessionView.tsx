import { useEffect, useState } from 'react'
import { Candle } from '@/domain/candles/candle'
import { evaluatePriceExpr } from '@/domain/strategies/priceExpr'
import { Strategy } from '@/domain/strategies/strategy'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { TestForwardSession } from '@/domain/testforward/session'
import { formatChartPrice, formatChartTime } from './chartData'

export interface TestForwardSessionViewProps {
  /** Sesión iniciada desde el formulario; null = aún no hay (§2.3). */
  session: TestForwardSession | null
  /** Velas cargadas en `App`: si cambian, la sesión se descarta (patrón Replay). */
  candles: readonly Candle[]
  /** Cursor tras cada acción (o null al descartar): App recorta el gráfico. */
  onProgress: (cursor: number | null) => void
}

const STRATEGY_LABELS: Record<StrategyState, string> = {
  [StrategyState.WaitingForSignal]: 'Esperando señal',
  [StrategyState.WaitingForEntryFill]: 'Entrada en vuelo',
  [StrategyState.WaitingForExitSignal]: 'Esperando salida',
  [StrategyState.WaitingForExitFill]: 'Salida en vuelo',
}

const STATUS_LABELS = {
  idle: 'En curso',
  awaiting: 'Esperando decisión',
  finished: 'Terminado',
} as const

/** Entradas del log que se pintan (el dominio guarda todas). */
const VISIBLE_LOG_ENTRIES = 100

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * UI de la sesión de test-forward (§2.3, patrón Replay): se monta **siempre**
 * en la pestaña Test-Forward (oculta fuera de ella) para no perder la sesión.
 * Decide confirmaciones (tomar/descartar · cerrar/mantener), avanza paso a
 * paso o salta al azar, gestiona los overrides de TP/SL y pinta progreso,
 * cuenta y log. La lógica vive en `TestForwardSession`; aquí solo se coordina
 * el estado de React. El cursor notificado a `App` recorta el gráfico.
 */
export function TestForwardSessionView({
  session,
  candles,
  onProgress,
}: TestForwardSessionViewProps) {
  const [error, setError] = useState<string | null>(null)
  // Mutaciones in-place del dominio: este contador fuerza el re-render.
  const [, setTick] = useState(0)
  const [tpInput, setTpInput] = useState('')
  const [slInput, setSlInput] = useState('')

  // Cambian las velas descargadas/importadas → la sesión deja de ser válida.
  useEffect(() => {
    if (session !== null && session.session.candles !== candles) {
      onProgress(null)
    }
  }, [session, candles, onProgress])

  if (session === null) {
    return (
      <section className="tf-session" aria-label="Sesión de test-forward">
        <p className="panel-hint" data-testid="tf-session-empty">
          Sin sesión: inicia un test-forward desde Experimentos.
        </p>
      </section>
    )
  }

  /** Ejecuta una acción de dominio y refresca el cursor + la vista. */
  const act = (action: () => void) => {
    try {
      action()
      setError(null)
      onProgress(session.cursor)
      setTick((value) => value + 1)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const cursor = session.cursor
  const awaiting = session.status === 'awaiting'
  const finished = session.status === 'finished'
  const confirmation = session.confirmation
  const strategy: Strategy = session.strategy
  const overrides = session.levelOverrides

  const lastCandle = cursor > 0 ? candles[cursor - 1] : candles[0]
  const markPrice = lastCandle?.close ?? 0
  const position = session.session.portfolio.position ?? null
  const pending = session.session.broker.pendingOrders().length
  const pendingPoints = session.points.filter((point) => point >= cursor).length

  /** Valor automático del nivel (la expresión de la estrategia sobre lo visto). */
  const levelAutoValue = (kind: 'tp' | 'sl'): number | null => {
    const level = kind === 'tp' ? strategy.takeProfit : strategy.stopLoss
    if (level === null || cursor === 0) return null
    const context = strategy.buildContext(candles.slice(0, cursor), {
      entry: position !== null && position.isOpen ? position.avgEntryPrice : null,
    })
    return evaluatePriceExpr(level.price, context)
  }

  const applyLevel = (kind: 'tp' | 'sl', price: number | null, enabled: boolean) => {
    if (kind === 'tp') session.setTakeProfit(price, enabled)
    else session.setStopLoss(price, enabled)
  }

  const applyManualLevel = (kind: 'tp' | 'sl') => {
    const label = kind === 'tp' ? 'Take profit' : 'Stop loss'
    const raw = kind === 'tp' ? tpInput : slInput
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value)) {
      setError(`${label}: indica un precio numérico`)
      return
    }
    act(() => applyLevel(kind, value, true))
  }

  /** Bloque de control de un nivel: solo si la estrategia lo declara (§1.5). */
  const levelBlock = (kind: 'tp' | 'sl') => {
    const level = kind === 'tp' ? strategy.takeProfit : strategy.stopLoss
    if (level === null) return null

    const label = kind === 'tp' ? 'Take profit' : 'Stop loss'
    const override = kind === 'tp' ? overrides.tp : overrides.sl
    const mode = override === undefined ? 'auto' : override === null ? 'off' : 'manual'
    const effective =
      mode === 'manual' && typeof override === 'number' ? override : levelAutoValue(kind)
    const display =
      mode === 'off'
        ? 'desactivado'
        : effective !== null
          ? `${formatChartPrice(effective)}${mode === 'manual' ? ' (manual)' : ''}`
          : 'automático'

    return (
      <div className="tf-level" data-testid={`tf-${kind}`}>
        <span data-testid={`tf-${kind}-value`}>
          {label}: {display}
        </span>
        <label className="field">
          <span>{label} manual</span>
          <input
            type="number"
            step="any"
            aria-label={`${label} precio manual`}
            value={kind === 'tp' ? tpInput : slInput}
            onChange={(event) =>
              kind === 'tp' ? setTpInput(event.target.value) : setSlInput(event.target.value)
            }
          />
        </label>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`Fijar ${label}`}
          onClick={() => applyManualLevel(kind)}
        >
          Fijar
        </button>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} automático`}
          onClick={() => act(() => applyLevel(kind, null, true))}
        >
          Auto
        </button>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`Desactivar ${label}`}
          onClick={() => act(() => applyLevel(kind, null, false))}
        >
          Desactivar
        </button>
      </div>
    )
  }

  const entries = session.log
  const logStart = Math.max(0, entries.length - VISIBLE_LOG_ENTRIES)

  return (
    <section className="tf-session" aria-label="Sesión de test-forward" data-testid="tf-session">
      <div className="replay-controls">
        <button
          type="button"
          className="button"
          data-testid="tf-step"
          onClick={() => act(() => session.step())}
          disabled={awaiting || finished}
        >
          Paso
        </button>
        <button
          type="button"
          className="button"
          data-testid="tf-jump"
          onClick={() => act(() => session.jump())}
          disabled={awaiting || finished}
        >
          Saltar (aleatorio)
        </button>
        <button
          type="button"
          className="button"
          data-testid="tf-reset"
          onClick={() => act(() => session.reset())}
        >
          Reiniciar
        </button>
      </div>

      {awaiting && confirmation !== null && (
        <div className="tf-decision" data-testid="tf-decision">
          <span>
            {confirmation.kind === 'entry' ? 'Entrada' : 'Salida'}: {confirmation.decision.reason}
          </span>
          {confirmation.kind === 'entry' ? (
            <>
              <button
                type="button"
                className="button"
                data-testid="tf-take"
                onClick={() => act(() => session.decide(true))}
              >
                Tomar
              </button>
              <button
                type="button"
                className="button"
                data-testid="tf-discard"
                onClick={() => act(() => session.decide(false))}
              >
                Descartar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button"
                data-testid="tf-close"
                onClick={() => act(() => session.decide(true))}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="button"
                data-testid="tf-keep"
                onClick={() => act(() => session.decide(false))}
              >
                Mantener
              </button>
            </>
          )}
        </div>
      )}

      <p className="replay-progress" data-testid="tf-progress">
        {cursor} / {candles.length} velas
        {lastCandle !== undefined && cursor > 0 ? <> · {formatChartTime(lastCandle.time)}</> : null}
        {' · '}
        {STATUS_LABELS[session.status]}
      </p>

      <dl className="replay-readout" data-testid="tf-readout">
        <div>
          <dt>Equity</dt>
          <dd data-testid="tf-equity">
            {formatChartPrice(session.session.portfolio.equity(markPrice))}
          </dd>
        </div>
        <div>
          <dt>Efectivo</dt>
          <dd data-testid="tf-cash">{formatChartPrice(session.session.portfolio.cash)}</dd>
        </div>
        <div>
          <dt>Posición</dt>
          <dd data-testid="tf-position">
            {position === null
              ? 'sin posición'
              : `${formatChartPrice(position.qty)} @ ${formatChartPrice(position.avgEntryPrice)}`}
          </dd>
        </div>
        <div>
          <dt>Estrategia</dt>
          <dd data-testid="tf-state">{STRATEGY_LABELS[session.session.instance.state]}</dd>
        </div>
        <div>
          <dt>Órdenes en vuelo</dt>
          <dd data-testid="tf-pending">{pending}</dd>
        </div>
        <div>
          <dt>Puntos pendientes</dt>
          <dd data-testid="tf-points">{pendingPoints}</dd>
        </div>
      </dl>

      <div className="tf-levels">
        {levelBlock('tp')}
        {levelBlock('sl')}
      </div>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="tf-session-error">
          {error}
        </p>
      )}

      <ul className="replay-log" role="log" data-testid="tf-log">
        {entries.slice(logStart).map((entry, index) => (
          <li key={logStart + index}>
            <span className="replay-log__time">{formatChartTime(entry.time)}</span> {entry.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
