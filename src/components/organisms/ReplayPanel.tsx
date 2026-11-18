import { useEffect, useState } from 'react'
import { describeError } from '@/components/utils/errorText'
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { MarketReplayEngine } from '@/domain/replay/replayEngine'
import { REPLAY_SPEEDS, replayIntervalMs } from '@/domain/replay/speed'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import { StrategyState } from '@/domain/strategies/strategyInstance'
import { DEFAULT_PARAMS, Params, validate } from '@/components/utils/backtestForm'
import { formatChartPrice, formatChartTime } from '@/components/utils/chartData'
import { Field } from '@/components/atoms/Field'
import { Button } from '@/components/atoms/Button'
import { Hint } from '@/components/atoms/Hint'

export interface ReplayPanelProps {
  candles: readonly Candle[]
  /** Base del intervalo de reproducción (1× = tiempo real, §7B). */
  timeframe: Timeframe
  /** Estrategia activa (§1.9); indicadores, reglas y precios viven en la spec. */
  strategy: StrategySpec | null
  onProgress: (cursor: number | null) => void
}

const STRATEGY_LABELS: Record<StrategyState, string> = {
  [StrategyState.WaitingForSignal]: 'Esperando señal',
  [StrategyState.WaitingForEntryFill]: 'Entrada en vuelo',
  [StrategyState.WaitingForExitSignal]: 'Esperando salida',
  [StrategyState.WaitingForExitFill]: 'Salida en vuelo',
}

/** Entradas del log que se pintan (el dominio guarda todas). */
const VISIBLE_LOG_ENTRIES = 100

/**
 * Panel de replay interactivo (Fase 5, §7B, UI mínima): formulario de la demo
 * `sma-cross`, transporte (reproducir/pausar/paso/reiniciar), velocidad en
 * tiempo real, progreso, lectura en vivo de la cuenta, operaciones manuales y
 * log de decisiones. La lógica vive en `MarketReplayEngine`; este componente
 * solo coordina el estado de React y un temporizador de `setTimeout`
 * encadenado (sin solapes).
 */
export function ReplayPanel({ candles, timeframe, strategy, onProgress }: ReplayPanelProps) {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const [engine, setEngine] = useState<MarketReplayEngine | null>(null)
  const [speed, setSpeed] = useState(1)
  const [fraction, setFraction] = useState('25')
  const [error, setError] = useState<string | null>(null)
  // Mutaciones del engine (objeto plano): este contador fuerza el re-render.
  const [tick, setTick] = useState(0)
  // Velas con las que se creó la sesión: si cambian, se descarta (datos nuevos).
  const [sessionCandles, setSessionCandles] = useState<readonly Candle[] | null>(null)

  const update = (key: keyof Params, value: string) =>
    setParams((previous) => ({ ...previous, [key]: value }))

  useEffect(() => {
    if (engine !== null && sessionCandles !== null && sessionCandles !== candles) {
      setEngine(null)
      setSessionCandles(null)
      onProgress(null)
    }
  }, [candles, engine, sessionCandles, onProgress])

  // Temporizador de reproducción: un paso por tick, encadenado tras completarse.
  useEffect(() => {
    if (engine === null || engine.status !== 'playing') return
    const delay = replayIntervalMs(timeframe, speed)
    const timer = setTimeout(() => {
      try {
        engine.step()
        onProgress(engine.cursor)
        setTick((value) => value + 1)
      } catch (caught) {
        setError(describeError(caught))
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [engine, speed, timeframe, onProgress, tick])

  const handleStart = () => {
    if (strategy === null) return
    const parsed = validate(params)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }

    try {
      const next = new MarketReplayEngine({
        strategy: buildStrategy(strategy),
        candles,
        timeframe,
        initialCapital: parsed.capital,
        execution: { slippageBps: parsed.slippageBps, feeBps: parsed.feeBps },
      })
      setSessionCandles(candles)
      setEngine(next)
      setError(null)
      onProgress(0)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const handleStep = () => {
    if (engine === null) return
    try {
      engine.step()
      onProgress(engine.cursor)
      setTick((value) => value + 1)
      setError(null)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const handlePlayPause = () => {
    if (engine === null) return
    try {
      if (engine.status === 'playing') engine.pause()
      else engine.play()
      setTick((value) => value + 1)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const handleReset = () => {
    if (engine === null) return
    engine.reset()
    onProgress(0)
    setTick((value) => value + 1)
    setError(null)
  }

  const handleManual = (side: 'buy' | 'sell') => {
    if (engine === null) return
    try {
      const ratio = Number(fraction) / 100
      const order = side === 'buy' ? engine.manualBuy(ratio) : engine.manualSell(ratio)
      if (order === null) {
        setError('La operación no es admisible con la cuenta actual (sin fondos o sin posición).')
        return
      }
      setError(null)
      setTick((value) => value + 1)
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const session = engine?.session ?? null
  const cursor = engine?.cursor ?? 0
  const finished = engine?.status === 'finished'
  const playing = engine?.status === 'playing'

  const lastCandle =
    session !== null ? (cursor > 0 ? session.candles[cursor - 1] : session.candles[0]) : undefined
  const markPrice = lastCandle?.close ?? 0
  const position = session?.portfolio.position ?? null
  const pending = session?.broker.pendingOrders().length ?? 0

  const fractionValue = Number(fraction)
  const fractionValid =
    Number.isInteger(fractionValue) && fractionValue >= 1 && fractionValue <= 100
  const canManual = engine !== null && !finished && fractionValid && pending === 0

  const entries = engine?.log ?? []
  const logStart = Math.max(0, entries.length - VISIBLE_LOG_ENTRIES)

  return (
    <section className="replay-panel" aria-label="Replay">
      <h2 className="panel-title">Replay</h2>

      {candles.length === 0 && (
        <p className="replay-panel__hint" data-testid="replay-empty">
          Sin velas: descarga o importa datos para reproducir el mercado.
        </p>
      )}

      {strategy === null ? (
        <Hint data-testid="replay-no-strategy">
          Sin estrategia seleccionada: elige una en "Estrategia".
        </Hint>
      ) : (
        <Hint data-testid="replay-strategy-hint">
          Estrategia: {strategy.name}@{strategy.version}
        </Hint>
      )}

      <div className="replay-form">
        <Field label="Capital inicial">
          <input
            type="number"
            min={0}
            step="any"
            value={params.capital}
            onChange={(event) => update('capital', event.target.value)}
          />
        </Field>
        <Field label="Comisión (bps)">
          <input
            type="number"
            min={0}
            step="any"
            value={params.feeBps}
            onChange={(event) => update('feeBps', event.target.value)}
          />
        </Field>
        <Field label="Slippage (bps)">
          <input
            type="number"
            min={0}
            step="any"
            value={params.slippageBps}
            onChange={(event) => update('slippageBps', event.target.value)}
          />
        </Field>
      </div>

      <Button onClick={handleStart} disabled={candles.length === 0 || strategy === null}>
        {engine === null ? 'Iniciar sesión' : 'Nueva sesión'}
      </Button>

      {error !== null && (
        <p className="status status--error" role="status" data-testid="replay-error">
          {error}
        </p>
      )}

      {engine !== null && session !== null && lastCandle !== undefined && (
        <>
          <div className="replay-controls">
            <Button onClick={handlePlayPause} disabled={finished} data-testid="replay-play">
              {playing ? 'Pausar' : 'Reproducir'}
            </Button>
            <Button onClick={handleStep} disabled={finished} data-testid="replay-step">
              Paso
            </Button>
            <Button onClick={handleReset}>Reiniciar</Button>
            <Field label="Velocidad">
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {REPLAY_SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="replay-progress" data-testid="replay-progress">
            {cursor} / {candles.length} velas
            {cursor > 0 ? <> · {formatChartTime(lastCandle.time)}</> : null}
          </p>

          <dl className="replay-readout" data-testid="replay-readout">
            <div>
              <dt>Equity</dt>
              <dd data-testid="replay-equity">
                {formatChartPrice(session.portfolio.equity(markPrice))}
              </dd>
            </div>
            <div>
              <dt>Efectivo</dt>
              <dd data-testid="replay-cash">{formatChartPrice(session.portfolio.cash)}</dd>
            </div>
            <div>
              <dt>Posición</dt>
              <dd data-testid="replay-position">
                {position === null
                  ? 'sin posición'
                  : `${formatChartPrice(position.qty)} @ ${formatChartPrice(position.avgEntryPrice)}`}
              </dd>
            </div>
            <div>
              <dt>Estrategia</dt>
              <dd data-testid="replay-strategy">{STRATEGY_LABELS[session.instance.state]}</dd>
            </div>
            <div>
              <dt>Órdenes en vuelo</dt>
              <dd data-testid="replay-pending">{pending}</dd>
            </div>
          </dl>

          <div className="replay-manual">
            <Field label="Fracción (%)">
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={fraction}
                onChange={(event) => setFraction(event.target.value)}
              />
            </Field>
            <Button onClick={() => handleManual('buy')} disabled={!canManual}>
              Comprar
            </Button>
            <Button onClick={() => handleManual('sell')} disabled={!canManual || position === null}>
              Vender
            </Button>
          </div>

          <ul className="replay-log" role="log" data-testid="replay-log">
            {entries.slice(logStart).map((entry, index) => (
              <li key={logStart + index}>
                <span className="replay-log__time">{formatChartTime(entry.time)}</span> {entry.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
