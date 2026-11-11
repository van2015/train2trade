# Plan de la Fase 4 — Backtesting

> Desglose de tareas para la Fase 4 de [`AGENTS.md`](../AGENTS.md) (§7A Backtesting, §9 Results &
> Analytics, §12A/§12C, §13 Fase 4): _"ejecutar un experimento completo sobre datos históricos"_.
>
> **Estado: completado (2026-11-11)** — T1…T8 implementados con TDD; `pnpm test && pnpm typecheck &&
pnpm format:check` en verde (**565 tests**, `pnpm build` OK) y `proyectstate.md` actualizado.
> Pendiente: aplicar los mensajes de commit sugeridos por tarea (AGENTS.md §Git: el agente no hace
> commits). Requisitos: AGENTS.md §7/§9/§12/§13.

## Decisiones cerradas

| Decisión                | Elección                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| UI                      | **UI mínima**: panel de backtest (parámetros, botón, tabla de métricas, equity curve). Sin trades sobre el gráfico de velas. |
| Métricas                | **Conjunto mínimo** (8): Net Profit, ROI, Max Drawdown, Sharpe, Profit Factor, Win Rate, Avg Trade, Expectancy.              |
| Persistencia            | **Solo en memoria**. localStorage de experimentos → Fase 6.                                                                  |
| Rango de datos          | **≤ 1000 velas** (MAX_CANDLES o CSV). La paginación de rangos largos sigue siendo tarea "inmediata" aparte.                  |
| Observabilidad          | **Decorador `RecordingBroker`** en vez de romper la API de `ExecutionEvent[]` de Fase 3 (payloads de fill vía decorador).    |
| Granularidad de `Trade` | **Un trade por cada cierre** (relleno `sell`, parcial o total): `entry = avgEntry` previo, `pnl` = incremento del realizado. |
| Rendimiento             | **O(n²) aceptado**: el runner reconstruye el contexto por vela; con ≤ 1000 velas es despreciable (ver puntos abiertos).      |

## Contratos propuestos

```
src/domain/
├── time/                       → Fase 4 (nuevo)
│   └── marketClock.ts          → MarketClock (§12A): tiempo de simulación determinista
└── backtest/                   → Fase 4 (nuevo; Experimentation Engine, §7)
    ├── trade.ts                → Trade (registro de operaciones, §6/§9)
    ├── recordingBroker.ts      → RecordingBroker: decorador de Broker que registra órdenes/fills
    ├── metrics.ts              → Métricas puras (§9, conjunto mínimo)
    ├── backtest.ts             → runBacktest(config): BacktestResult
    └── experiment.ts           → Experiment (§9): config + resultado, reproducible (§12C)

src/components/
├── BacktestPanel.tsx           → formulario + métricas + equity + tabla de trades
├── EquityChart.tsx             → equity curve (lightweight-charts, serie de área)
└── chartData.ts                → ampliar con el mapper de equity
```

```ts
// §12A — el tiempo deja de ser "el índice de la vela": reloj de simulación con avance estricto
class MarketClock {
  get now(): number | null // null antes del primer avance
  advanceTo(time: number): void // estrictamente creciente → si no, error de dominio
}

interface TradeData {
  entryTime: number // apertura de la posición cerrada (ms)
  entryPrice: number // coste unitario con fees de entrada (semántica de Position)
  exitTime: number
  exitPrice: number // precio efectivo del relleno (con slippage)
  qty: number
  pnl: number // neto: (exit - entry) * qty - fee de salida
  fees: number // comisión de salida (la de entrada va embebida en entryPrice)
}
// Invariante testeable: Σ trades.pnl ≈ portfolio.realizedPnl tras un cierre total

class RecordingBroker implements Broker {
  constructor(inner: Broker, account: Account)
  get trades(): readonly Trade[] // un registro por cierre (snapshot de posición PREVIO al fill)
  get orders(): readonly Order[] // órdenes enviadas con su estado final
}

interface BacktestConfig {
  strategy: Strategy
  candles: readonly Candle[]
  timeframe: Timeframe // anualización del Sharpe + registro (§12C)
  initialCapital: number
  execution?: ExecutionModelConfig // slippageBps / feeBps (por defecto 0)
  risk?: RiskConfig // por defecto {}
}
interface EquityPoint {
  time: number
  equity: number
} // un punto por cierre de vela
interface Metrics {
  netProfit: number
  roi: number
  maxDrawdown: number // fracción en [0, 1]
  sharpe: number | null // sin riesgo libre; n < 2 retornos o equity plano → null; varianza 0 con media ≠ 0 → ±∞
  profitFactor: number | null // sin pérdidas → null (se muestra "—")
  winRate: number | null // sin trades cerrados → null
  avgTrade: number | null
  expectancy: number | null
}
function runBacktest(config: BacktestConfig): BacktestResult

// §9 + §12C: todo lo que condiciona el resultado queda registrado
class Experiment {
  readonly strategyId: string // "name@version"
  readonly timeframe: Timeframe
  readonly period: { from: number; to: number }
  readonly initialCapital: number
  readonly execution: Required<ExecutionModelConfig>
  readonly risk: Required<RiskConfig>
  readonly result: BacktestResult
  static run(config: BacktestConfig): Experiment
}
```

**Convención de equity**: un punto por cierre de vela (`portfolio.equity(candle.close)`) — el P&L
marcado incluye la posición abierta; los `Trade` solo registran cierres (una posición abierta al
final **no** se cierra a mercado, ver puntos abiertos).

## Tareas (TDD: firma + tests en rojo → implementación → verde → gates)

### T1 — MarketClock (§12A)

- **Archivos:** `src/domain/time/marketClock.ts` ↔ `test/domain/time/marketClock.test.ts`
- `now` (null inicial), `advanceTo(time)` estrictamente creciente; tiempo inválido (no finito,
  negativo) o no monótono → error de dominio (`DomainError` con `this.name`).
- **Aceptación:** determinista y puro (sin `Date.now`); base para el replay de Fase 5.

### T2 — Trade (registro de operaciones)

- **Archivos:** `src/domain/backtest/trade.ts` ↔ `test/domain/backtest/trade.test.ts`
- `Trade` inmutable con validación (`InvalidTradeError`); `win` (pnl > 0), `durationMs`.
- **Aceptación:** `pnl` neto de fees de salida; invariantes de construcción (qty > 0, tiempos
  ordenados, exit >= 0).

### T3 — RecordingBroker (decorador)

- **Archivos:** `src/domain/backtest/recordingBroker.ts` ↔ `test/domain/backtest/recordingBroker.test.ts`
- Envuelve cualquier `Broker` + `Account`: delega `submitOrder`/`cancelOrder`/`advance`/consultas y,
  por cada vela, **snapshot de la posición antes de delegar** → al llegar un `fill` `sell` construye
  el `Trade` (parcial o total) y lo registra. Órdenes enviadas se apilan con su estado final.
- **Aceptación:** comportamiento idéntico al broker interior (mismos fills/rechazos); un rechazo no
  genera trade; el invariante `Σ trades.pnl = realizedPnl` se cumple tras cerrar.

### T4 — Métricas (§9, conjunto mínimo)

- **Archivos:** `src/domain/backtest/metrics.ts` ↔ `test/domain/backtest/metrics.test.ts`
- 8 funciones puras sobre `trades + equityCurve + initialCapital + timeframe`:
  - `netProfit` = equity final − inicial; `roi` = netProfit / inicial.
  - `maxDrawdown` = max(1 − equity / pico) sobre la curva.
  - `sharpe` = media/desv de retornos por vela × √(msAño / timeframe.ms); desv muestral (n−1);
    n < 2 → `null`; sin riesgo libre.
  - `profitFactor` = ∑ganancias / |∑pérdidas|; sin pérdidas → `null`.
  - `winRate` / `avgTrade` / `expectancy` sobre `Trade` cerrados; sin trades → `null`.
- **Aceptación:** casos borde (0 trades, equity plano, 1 solo retorno, todas ganancias) sin `NaN`.

### T5 — `runBacktest` (ejecución automática)

- **Archivos:** `src/domain/backtest/backtest.ts` ↔ `test/domain/backtest/backtest.test.ts`
- Ensambla `Portfolio + RiskManager + HistoricalBroker + RecordingBroker + StrategyRunner +
MarketClock` y recorre las velas: `clock.advanceTo` → `runner.onCandle(candles[0..i])` → muestrea
  equity. Devuelve `BacktestResult { trades, equityCurve, metrics, finalEquity, orders, events }`.
- **Aceptación:** ciclo completo con la estrategia de cruce (E2E de Fase 3); `finalEquity` coherente
  con `Σ pnl` (sin posición abierta); anti look-ahead heredado; **determinismo**: dos ejecuciones
  idénticas → resultados `toEqual`.

### T6 — Experiment (§9/§12C)

- **Archivos:** `src/domain/backtest/experiment.ts` ↔ `test/domain/backtest/experiment.test.ts`
- Valida la config (velas no vacías y ascendentes, capital > 0, timeframe válido); registra
  `strategyId`, periodo, capital, modelo de ejecución y riesgo **completos**.
- **Aceptación:** `Experiment.run(x)` dos veces → resultados idénticos (§12C) y el registro contiene
  todo lo que condiciona el resultado.

### T7 — UI mínima

- **Archivos:** `src/components/BacktestPanel.tsx`, `EquityChart.tsx` + extensión de `chartData.ts`
  ↔ tests espejo en `test/components/`
- `BacktestPanel` recibe `candles` (cargados en `App` vía `DataControls`/CSV) y ofrece: capital
  inicial, `feeBps`/`slippageBps`, periodos SMA rápida/lenta (**estrategia demo de cruce**, el
  editor de estrategias sigue pendiente), botón _Ejecutar backtest_, tabla de métricas (`—` en
  nulls), equity curve y tabla resumida de trades.
- `EquityChart`: serie de área con `lightweight-charts` (mismo patrón que `CandleChart`).
- **Aceptación:** valida inputs (capital > 0, bps ≥ 0, **periodos enteros ≥ 1** — mismo criterio
  que `IndicatorPanel`); sin velas → aviso y botón deshabilitado, sin crash; ejecutar pinta métricas
  y equity; smoke test en `App.test.tsx` + E2E UI (velas del repositorio → métricas).

### T8 — E2E, docs y cierre de fase

- **Archivos:** test de integración (panel → `Experiment.run` → resultado) + docs.
- Escenario completo sobre una serie conocida: métricas verificadas a mano, `Σ pnl` = equity final,
  determinismo, y actualización de `proyectstate.md` (Fase 4 completa + contadores),
  `domain-diagram-phase3.md` (paquetes `time` y `backtest` en el árbol y sus dependencias) y este
  plan (estado completado).
- **Aceptación (gate de fase):** `pnpm test && pnpm typecheck && pnpm format:check` en verde y
  `pnpm build` compila.

## Orden y dependencias

```
T1 MarketClock ─┐
T2 Trade ─→ T3 RecordingBroker ─┐
T4 Métricas ────────────────────┼─→ T5 runBacktest ─→ T6 Experiment ─→ T7 UI ─→ T8 E2E/docs
```

Cada tarea es una ronda TDD independiente con el gate en verde antes de empezar la siguiente.
Como novedad (AGENTS.md §Git): **el agente no hace commits** — al terminar cada tarea se **sugiere
un mensaje de commit** para que lo aplique quien gestione el repo.

## Fuera de alcance (queda para después)

- Paginación de rangos largos y más proveedores (tarea "inmediata", no bloquea el motor).
- Indicadores restantes: MACD, ATR, Bollinger, VWAP.
- Persistencia y comparación de `Experiment` (Fase 6), optimización y test-forward.
- Resto de métricas §9: Sortino, tiempo medio en posición, exposición media.
- Replay interactivo (Fase 5): velocidad, pausa, paso a vela — el `MarketClock` de T1 es su base.
- Editor de estrategias en la UI; trades y drawdown sobre el gráfico de velas (UI completa).
- Eventos estructurados con payload (§12D): hoy el payload vive en `RecordingBroker`; si aparecen
  suscriptores reales, se replantea la forma de `ExecutionEvent`.

## Puntos abiertos

1. **Rendimiento O(n²)** (único abierto): el contexto se reconstruye por vela (slicing +
   indicadores). Aceptado con ≤ 1000 velas. **Disparador**: backtest perceptiblemente lento o
   > 5 000 velas → cálculo incremental de indicadores.

### Resueltos durante la implementación

- **Posición abierta al final**: se marca a mercado en `finalEquity`/equity y **no** genera `Trade`
  (las métricas de trades solo ven cierres); no se fuerza el cierre — queda para Fase 6 junto con la
  comparación de experimentos.
- **Anualización del Sharpe**: documentada en el código (año de 365 días, sin riesgo libre, desv
  muestral n−1); con varianza 0 y media ≠ 0 → ±∞, equity plano o < 2 retornos → `null`. Asume velas
  contiguas: si los datos traen huecos → futura corrección con gaps explícitos.
- **Estrategia de la UI**: cruce SMA paramétrico implementado (`sma-cross`); el editor de
  estrategias (§4) sigue siendo transversal pendiente.
- **Validación de periodos**: enteros ≥ 1 (mismo criterio que `IndicatorPanel`, no ≥ 2 como se
  planteó al planificar).
