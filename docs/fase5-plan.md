# Plan de la Fase 5 — Simulación interactiva (replay)

> Desglose de tareas para la Fase 5 de [`AGENTS.md`](../AGENTS.md) (§7B Historical Replay, §12A,
> §13 Fase 5): _"investigar el comportamiento de una estrategia observando cómo evoluciona el
> mercado"_.
>
> **Estado: en planificación (2026-11-12)** — rama `phase5` creada desde `main` (`c35cb45`).
> Requisitos: AGENTS.md §7/§12/§13. La Fase 4 (backtesting) está cerrada (565 tests en verde);
> esta fase **reutiliza su stack** y lo convierte en un motor compartido con el backtest, tal como
> pide §7: _"Backtesting y Historical Replay deberían compartir el mismo mecanismo fundamental de
> reproducción de datos. La diferencia estaría en cómo se controla el tiempo y cómo se presenta la
> ejecución"_.

## Contexto: qué exige §7B y cómo se cumple

| Requisito (§7B/§13)                                 | Cumplimiento                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Reproducir el mercado a velocidad normal            | Timer con intervalo `timeframe.ms / speed` (1× = tiempo real) — T3 + T4                |
| Aumentar o reducir la velocidad                     | Presets de multiplicador 0.5×–3600×, recalculan el intervalo — T3 + T4                 |
| Pausar y continuar                                  | Máquina de estados `ready → playing → ready` del engine — T2 + T4                      |
| Avanzar vela a vela                                 | `step()` del engine (una vela por llamada) — T2 + T4                                   |
| Observar los indicadores                            | El `CandleChart` (con sus líneas) se recorta a las velas consumidas — T4               |
| Observar las decisiones de la estrategia            | Log de eventos por paso + lectura del estado de `StrategyInstance` — T2 + T4           |
| Intervenir manualmente (abrir/cerrar)               | `manualBuy`/`manualSell` sobre el mismo broker, con sizing de `RiskManager` — T2 + T4  |
| Sin look-ahead: la estrategia solo ve lo disponible | Heredado del `StrategyRunner` (orden de la vela N rellena en N+1): **no se toca** — T1 |

La base temporal ya existe desde la Fase 4: `MarketClock` (§12A) es la única fuente del
"tiempo estrictamente creciente" y lo avanza el runner con cada vela.

## Decisiones cerradas

| Decisión              | Elección                                                                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor compartido (§7) | **`TradingSession`** en `src/domain/trading/`: ensambla `Portfolio + RiskManager + RecordingBroker(HistoricalBroker) + StrategyRunner + MarketClock` y avanza **vela a vela**. `runBacktest` y `MarketReplayEngine` lo consumen (§14: Experimentation no implementa otro Trading Engine). |
| Estados del replay    | `ready → playing → finished` + `reset()`; transiciones/pasos inválidos → `ReplayError`. `ready` cubre el estado inicial y el pausado (ambos admiten `step()` manual).                                                                                                                     |
| Velocidad             | **Multiplicador en tiempo real**: `interval = clamp(timeframe.ms / speed, 16 ms, 1 h)`; presets `[0.5, 1, 10, 60, 600, 3600]`, por defecto 1× (§7B "velocidad normal"). Timer con **`setTimeout` encadenado** (sin solapes).                                                              |
| Operaciones manuales  | **Fracción del equity vía `RiskManager`** (compra: `addQty`; venta: fracción de la posición, nunca bloqueada) → orden **market** rellenada en la apertura de la **siguiente** vela (mismo anti look-ahead que la estrategia).                                                             |
| Orden única en vuelo  | **Regla global**: no se acepta una orden manual si hay alguna pendiente (estrategia o manual). Preserva el supuesto de `RecordingBroker` (≤ 1 fill por vela → `Σ trades.pnl = realizedPnl`) y evita rechazos cruzados.                                                                    |
| Visualización         | **Log cronológico en el panel** (eventos, órdenes, rellenos con precio, rechazos con motivo) + **`CandleChart` recortado** a las velas consumidas (velas **e** indicadores). Sin marcadores de trades sobre las velas.                                                                    |
| Estrategia            | Misma **demo `sma-cross`** de `BacktestPanel` (el editor de estrategias sigue siendo pendiente transversal).                                                                                                                                                                              |
| UI                    | **UI mínima** (patrón Fase 4): un panel `ReplayPanel`. El formulario se **duplica** con `BacktestPanel` por ahora; extraerlo a `backtestForm.ts` queda para Fase 6 (T8), que ya lo prevé.                                                                                                 |
| Alcance de análisis   | El replay **no calcula métricas** ni equity curve en vivo: sigue siendo trabajo del backtest (Fase 4). `TradingSession` sí acumula `equityCurve`, que consume `runBacktest`.                                                                                                              |
| Observabilidad (§12D) | Sin bus de eventos: el log se construye a partir de los `ExecutionEvent[]` del paso + diffs de órdenes/`fills` del `RecordingBroker` (ampliado con `fills`, payload vía decorador como decidió Fase 4).                                                                                   |
| Log en memoria        | El dominio acumula **todas** las entradas (acotadas por el nº de velas); la UI pinta las **últimas 100**.                                                                                                                                                                                 |
| Errores               | `TradingSessionError` y `ReplayError` (clases de dominio con `this.name`, patrón del repo).                                                                                                                                                                                               |

## Contratos propuestos

```ts
// T1 — motor de reproducción compartido (§5/§7/§14)
// src/domain/trading/tradingSession.ts
export type SessionRiskConfig = Omit<RiskConfig, 'feeBps' | 'slippageBps'> // era BacktestRiskConfig
export interface TradingSessionConfig {
  strategy: Strategy
  candles: readonly Candle[] // ascendentes y no vacías (validación incremental, como hoy)
  timeframe: Timeframe // registro §12C + anualización del Sharpe en el backtest
  initialCapital: number
  execution?: ExecutionModelConfig
  risk?: SessionRiskConfig
}
export interface ConfigProblem {
  reason: string
  raw: unknown
} // movido de backtest.ts (fuente única de validación)
export function findConfigProblem(config: TradingSessionConfig): ConfigProblem | null

export interface CandleStep {
  index: number // índice de la vela procesada (0-based)
  candle: Candle
  events: readonly ExecutionEvent[] // eventos de ESTA vela
  equity: number // portfolio.equity(candle.close)
}
export class TradingSessionError extends DomainError {}

export class TradingSession {
  constructor(config: TradingSessionConfig) // findConfigProblem → TradingSessionError
  get cursor(): number // velas procesadas (0 antes del primer advance)
  get finished(): boolean
  get portfolio(): Portfolio
  get instance(): StrategyInstance
  get clock(): MarketClock
  get trades(): readonly Trade[]
  get orders(): readonly Order[]
  get fills(): readonly Fill[] // amplía RecordingBroker (T2)
  get events(): readonly ExecutionEvent[] // secuencia aplanada acumulada (§12D)
  get equityCurve(): readonly EquityPoint[] // un punto por cierre de vela
  get executionConfig(): Required<ExecutionModelConfig>
  get riskConfig(): Required<RiskConfig>
  advance(): CandleStep // procesa la siguiente vela; finished → TradingSessionError
  submitOrder(order: Order): Order // delega en el broker (órdenes manuales, T2)
}

// backtest.ts queda como fachada: BacktestConfig = TradingSessionConfig (alias),
// BacktestRiskConfig/findConfigProblem re-exportados, runBacktest = bucle sobre la sesión.
// experiment.ts no cambia de comportamiento (sigue validando con ExperimentError).

// T2 — replay interactivo (§7B)
// src/domain/replay/replayEngine.ts
export type ReplayStatus = 'ready' | 'playing' | 'finished'
export class ReplayError extends DomainError {}

export type ReplayLogKind = 'strategy' | 'order' | 'fill' | 'rejection' | 'manual'
export interface ReplayLogEntry {
  time: number // clock.now (cierre de la última vela procesada)
  kind: ReplayLogKind
  text: string // p. ej. "PositionOpened", "Compra 0.01 @ 61234.5 (o3)", "rechazada: efectivo insuficiente"
  orderId?: string
}
export interface ReplayStep {
  index: number
  time: number
  status: ReplayStatus // estado tras el paso ('finished' al procesar la última vela)
  events: readonly ExecutionEvent[]
  log: readonly ReplayLogEntry[] // entradas nuevas de este paso
}

export class MarketReplayEngine {
  constructor(config: TradingSessionConfig)
  readonly session: TradingSession
  get status(): ReplayStatus
  get cursor(): number
  get log(): readonly ReplayLogEntry[]
  play(): void // ready → playing; playing/finished → ReplayError
  pause(): void // playing → ready; ready/finished → ReplayError
  step(): ReplayStep // ready|playing → avanza una vela; finished → ReplayError
  reset(): void // stack NUEVO con la misma config → ready, log vacío (§12C: mismo recorrido)
  /** Fracción del equity vía RiskManager; null si no es admisible. finished → ReplayError. */
  manualBuy(fraction: number): Order | null
  /** Fracción de la posición abierta; null si no hay posición. finished → ReplayError. */
  manualSell(fraction: number): Order | null
}
// Regla: manual* → ReplayError si broker.pendingOrders().length > 0 (orden única en vuelo).
// Órdenes manuales con id `m<n>` (las de estrategia siguen siendo `o<n>`): distinción en el log.
// createdAt = clock.now ?? candles[0].time (admitido antes del primer paso).

// T3 — velocidad (§7B)
// src/domain/replay/speed.ts
export const REPLAY_SPEEDS: readonly number[] = [0.5, 1, 10, 60, 600, 3600]
export const MIN_REPLAY_INTERVAL_MS = 16 // ~60 fps
export const MAX_REPLAY_INTERVAL_MS = 3_600_000
/** Intervalo en ms entre pasos: tiempo real / speed, acotado. speed no finita o <= 0 → ReplayError. */
export function replayIntervalMs(timeframe: Timeframe, speed: number): number

// T4 — UI mínima
// src/components/ReplayPanel.tsx
export interface ReplayPanelProps {
  candles: readonly Candle[]
  timeframe: Timeframe
  /** Cursor tras cada avance (o null al descartar la sesión): App recorta el gráfico. */
  onProgress: (cursor: number | null) => void
}
```

## Tareas (TDD: firma + tests en rojo → implementación → verde → gates)

### T1 — `TradingSession`: motor compartido y refactor de `runBacktest` (§7)

- **Archivos:** `src/domain/trading/tradingSession.ts` ↔ `test/domain/trading/tradingSession.test.ts`;
  refactor de `src/domain/backtest/backtest.ts` (y ajuste de imports en `experiment.ts` si hace
  falta). `BacktestConfig`, `BacktestRiskConfig`, `findConfigProblem` y `ConfigProblem` se mudan a
  `tradingSession.ts` y se **re-exportan** desde `backtest.ts` (API pública intacta).
- `TradingSession` monta exactamente el stack de `runBacktest` actual (misma construcción de
  `Portfolio`, `NextOpenExecutionModel`, `RiskManager` con costes únicos, `RecordingBroker`,
  `StrategyRunner` con su `MarketClock`) y expone `advance()`: `runner.onCandle(candles.slice(0,
cursor + 1))` → acumula equity y eventos → `CandleStep`.
- `runBacktest` pasa a ser: validar (`findConfigProblem` → `BacktestError`) → `while (!finished)
session.advance()` → `computeMetrics` sobre los datos de la sesión. **Sin cambio de
  comportamiento** (los tests existentes son la regresión).
- **Aceptación:** los 565 tests actuales verdes sin tocarlos (mismos resultados, mismos errores de
  config); nuevos tests de sesión: cursor/finished, `advance` en finished → `TradingSessionError`,
  anti look-ahead (orden de la vela N rellena en N+1), determinismo (dos sesiones → mismo
  recorrido), `equityCurve` con un punto por vela, `Σ trades.pnl` coherente con el realized.

### T2 — `MarketReplayEngine`: estados, manuales y log (§7B)

- **Archivos:** `src/domain/replay/replayEngine.ts` ↔ `test/domain/replay/replayEngine.test.ts`;
  `src/domain/backtest/recordingBroker.ts` (+ `fills`, test ampliado) y
  `src/domain/trading/tradingSession.ts` (+ `submitOrder`, + `fills`).
- Estados y transiciones (`play`/`pause`/`step`/`reset`) según contrato; `reset` reconstruye el
  stack con la config guardada (la `Strategy` es reutilizable, es estadoless).
- **Manuales:** `manualBuy(fraction)` → `risk.addQty(portfolio, price, fraction)`; `manualSell` →
  `position.qty * fraction` (reduce nunca se bloquea); qty `null` → devuelve `null` sin enviar
  nada; orden market con id `m<n>` enviada vía `session.submitOrder`. **Regla de orden única en
  vuelo** (`pendingOrders().length > 0` → `ReplayError`).
- **Log por paso:** entradas derivadas de `events` (nombres de dominio), rellenos con
  precio/cantidad (cruzando `session.fills`), resoluciones de orden con `rejectReason`, y entradas
  `manual` propias (envío y relleno). Solo se registran pasos con algo que contar.
- **Aceptación:** transiciones inválidas y `step` en finished → `ReplayError`; manual antes del
  primer paso y entre pasos rellena en la **siguiente** vela (anti look-ahead); regla de orden
  única testeada; con manuales de por medio se mantiene `Σ trades.pnl = realizedPnl`; `reset` →
  mismo recorrido que una sesión nueva (§12C); log refleja eventos, fills y rechazos con motivo.

### T3 — Velocidad (§7B)

- **Archivos:** `src/domain/replay/speed.ts` ↔ `test/domain/replay/speed.test.ts`.
- `replayIntervalMs(timeframe, speed)` = `clamp(timeframe.ms / speed, 16 ms, 1 h)`; presets
  `REPLAY_SPEEDS`; speed no finita o ≤ 0 → `ReplayError`.
- **Aceptación:** 1× = `timeframe.ms` (tiempo real); 0.5× duplica el intervalo; acotado por
  arriba y por abajo en ambos extremos; casos borde (`speed` gigante → 16 ms) sin `NaN`.

### T4 — UI: `ReplayPanel` + gráfico recortado

- **Archivos:** `src/components/ReplayPanel.tsx` ↔ `test/components/ReplayPanel.test.tsx`;
  `src/components/App.tsx` (estado `replayCursor`, slicing de velas **y** de `buildLines`,
  subtítulo "Fase 5") ↔ `App.test.tsx`.
- **Formulario** (idéntico al de `BacktestPanel`: capital > 0, bps ≥ 0, SMA enteros ≥ 1) →
  `new MarketReplayEngine(config)`; errores de dominio en el panel; sin velas → aviso y botones
  deshabilitados.
- **Controles:** Iniciar sesión, Reproducir/Pausar, Paso, Reiniciar, selector de velocidad
  (presets); progreso `cursor/N velas` + última vela; lectura en vivo: equity, efectivo,
  posición (qty @ precio medio), estado de la estrategia y órdenes pendientes.
- **Manuales:** campo fracción (%) entero 1–100 + botones _Comprar_/_Vender_; deshabilitados sin
  sesión, en finished, sin posición (venta) o con orden en vuelo; resultado (`null` → aviso).
- **Log:** lista `role="log"` con las últimas 100 entradas (tiempo + texto).
- **Timer:** `setTimeout` encadenado con `replayIntervalMs(timeframe, speed)` mientras
  `status === 'playing'`; limpieza en pausa y unmount; cada paso notifica `onProgress(cursor)`.
- **Slicing en `App`:** con sesión activa, `visible = candles.slice(0, cursor)` alimenta
  `CandleChart` **y** `buildLines(visible, settings)` (los indicadores tampoco ven el futuro);
  sin sesión (`null`) → todo el rango como hoy. Si cambian las velas descargadas, el panel
  descarta la sesión y notifica `onProgress(null)`.
- **Aceptación:** flujo iniciar → Paso → exactamente 1 vela visible (y sus líneas); reproducir
  con fake timers avanza; pausa detiene; al terminar, gráfico completo; validaciones del
  formulario; smoke en `App.test.tsx` (mock de `CandleChart` con el nº de velas recibidas).

### T5 — E2E, docs y cierre de fase

- **Archivos:** `test/domain/replay/replayE2E.test.ts` + docs.
- Escenario sobre una serie conocida: (1) sesión paso a paso **sin manuales** → mismos
  `trades`/`equityCurve`/`events`/`finalEquity` que `runBacktest` (garantía de motor compartido);
  (2) `manualBuy` a mitad del recorrido → relleno en la vela siguiente, invariantes de Fase 4
  intactos y log coherente; (3) `reset` → recorrido idéntico (§12C); (4) `manualSell` cierra y
  registra el `Trade`.
- Docs: `proyectstate.md` (Fase 5 completa + contadores), `domain-diagram-phase3.md` (paquete
  `replay/`, `trading/tradingSession.ts`, dependencias `backtest → trading` y `replay → trading`)
  y este plan (estado completado).
- **Aceptación (gate de fase):** `pnpm test && pnpm typecheck && pnpm format:check` en verde y
  `pnpm build` compila.

## Orden y dependencias

```
T1 TradingSession + refactor runBacktest ─→ T2 MarketReplayEngine ─┬→ T4 UI ─→ T5 E2E/docs
                                                                   │
                                          T3 Velocidad (independiente) ┘
```

T3 es un helper puro sin dependencias y puede alternarse con T2. Cada tarea es una ronda TDD con
el gate en verde antes de la siguiente. Como en fases previas (AGENTS.md §Git): **el agente no
hace commits** — al terminar cada tarea se **sugiere un mensaje de commit** para quien gestione el
repo.

Mensajes sugeridos por tarea:

- T1 `refactor: extract TradingSession as shared candle-by-candle engine`
- T2 `feat: add MarketReplayEngine with states, manual orders and event log`
- T3 `feat: add real-time replay speed helper`
- T4 `feat: add replay panel with transport controls and cropped chart`
- T5 `test: add Phase 5 E2E suite and update phase docs`

## Fuera de alcance (queda para después)

- Marcadores de trades/señales sobre el gráfico de velas; equity curve en vivo durante el replay.
- Suscripción/event bus de eventos de dominio (§12D, pendiente transversal): el log del replay no
  introduce despacho, solo lee lo que el paso devuelve.
- **Paper trading con datos en vivo** (§6 `PaperTradingBroker`): no hay flujo de tiempo real.
- Cancelación manual de órdenes pendientes y órdenes limit manuales (hoy: market por fracción).
- Persistencia/reanudación de sesiones de replay (tampoco de experimentos: Fase 6).
- Editor de estrategias en la UI; otras estrategias además de la demo `sma-cross`.
- Métricas, comparación y optimización en el replay (Fase 6, sobre backtests).
- Extracción del formulario compartido `backtestForm.ts` (Fase 6, T8).

## Puntos abiertos

1. **Orden única en vuelo (decisión estructural)**: bloquea un manual mientras la estrategia tiene
   una orden pendiente (con la demo `market` dura como mucho hasta la siguiente vela; con órdenes
   `limit` podría prolongarse). **Mitigación:** preserva el supuesto de `RecordingBroker` (≤ 1 fill
   por vela) y la invariantes de Fase 4. **Disparador:** límites en la UI → replantear
   `RecordingBroker` para registrar trades por relleno con posición incremental.
2. **Velocidad por defecto 1× (tiempo real)**: con timeframes de 1 h no se ve movimiento durante
   un hora. Se asume por fidelidad a §7B; si en la práctica resulta lento → subir el default
   (cambio de una constante en `ReplayPanel`).
3. **Reproducción a altas velocidades**: con el mínimo de 16 ms por vela, el render por paso puede
   no seguir el ritmo en series largas. **Mitigación:** clamp + `setTimeout` encadenado (nunca
   solapado). **Disparador:** tirones perceptibles → avanzar N velas por tick.
4. **Gráfico vacío al iniciar** (cursor 0): es honesto — la estrategia aún no ve nada — pero puede
   confundir; el panel muestra el aviso. Si confunde en uso → mostrar la primera vela al iniciar.
5. **Rechazos cruzados manuales/estrategia**: con la regla del punto 1 no deberían producirse dos
   órdenes en vuelo; si se relaja, el broker rechaza de forma controlada y el runner reenvía su
   señal (comportamiento ya testeado en Fase 3).
6. **Posición abierta al final del replay**: como en Fase 4, no se cierra a mercado (el cierre
   `closePositionAtEnd` es de Fase 6); el usuario puede cerrarla a mano con _Vender_.

### Resueltos durante la implementación

- _(pendiente)_
