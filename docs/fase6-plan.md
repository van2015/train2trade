# Plan de la Fase 6 — Experimentación avanzada

> Desglose de tareas para la Fase 6 de [`AGENTS.md`](../AGENTS.md) (§7B Historical Replay como base
> de datos divididos, §7C Test-forward, §9 Results & Analytics, §12C Reproducibilidad, §13 Fase 6):
> _"un laboratorio para desarrollar y validar sistemas de trading"_.
>
> **Estado: en implementación (2026-11-12)** — rama `phase6` creada desde `main` (`dd1ce77`);
> T0…T5 completadas con TDD (705 tests en verde). Pendiente: T6…T9.
> Requisitos: AGENTS.md §7/§9/§12/§13. La **Fase 5 (replay interactivo) sigue pendiente y no
> bloquea esta fase**: solo comparten `MarketClock`, que ya existe desde la Fase 4.

## Contexto y corrección de alcance (T0)

AGENTS.md §8/§13 describen "asignación de capital entre estrategias" y "gestión de múltiples
estrategias y capital". **Eso no aplica al producto**: el modelo real es **un experimento = una
estrategia + su propio capital**; nunca un mismo capital operado por varias estrategias. Varias
estrategias conviven como **experimentos separados** que se comparan entre sí. La T0 corrige esa
documentación antes de implementar.

Tampoco hay dependencia con la Fase 5: esta fase solo usa datos históricos ya cargados
(`CandleRepository`) y el motor de backtest de la Fase 4.

## Decisiones cerradas

| Decisión           | Elección                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modelo de capital  | **Sin capital compartido**: cada experimento, una estrategia y su capital. Corrige AGENTS.md §8/§13 (T0).                                                                                                                             |
| UI                 | **UI mínima por módulo** (patrón Fase 4): panel de historial + comparación, modo test-forward y panel de optimización. Sin heatmap ni equity superpuestos.                                                                            |
| Optimización       | **Grid search determinista** (rejilla de combinaciones, orden estable) + **análisis de sensibilidad/vecindario** sobre la rejilla. Sin walk-forward ni muestreo aleatorio.                                                            |
| Persistencia       | **localStorage de `ExperimentSnapshot`** (metadata + métricas + equity + trades; **sin** `orders`/`events`, que son pesados y no hacen falta para comparar). Id determinístico → re-ejecutar = overwrite, sin duplicados.             |
| Guardado           | **Auto-guardo** al ejecutar backtest/test-forward (dedupe por id); la optimización no guarda runs individuales (solo la UI muestra el mejor).                                                                                         |
| Fingerprint (§12C) | Serialización canónica del grafo de `Strategy` (props propios ordenados alfabéticamente; **sin** `constructor.name` por minificación) → hash FNV-1a propio en hex.                                                                    |
| Cierre al final    | `closePositionAtEnd?: boolean` (pendiente heredado de Fase 4, por defecto `false`): cierra la posición abierta al cierre de la última vela con los mismos costes → `Trade` final y métricas de trades comparables entre experimentos. |
| Cap de la rejilla  | `MAX_OPTIMIZATION_RUNS = 1000` combinaciones (mismo espíritu que `MAX_CANDLES`); se acepta el O(n²) heredado de Fase 4.                                                                                                               |
| Comparación        | Tabla de métricas + **`differences`**: avisos cuando varían periodo/instrumento/timeframe/capital/riesgo entre filas (§12C). Ranking con `nulls` al final.                                                                            |
| Test-forward       | Corte por **tiempo** (`cutTime`): `development` = velas `< cut`, `evaluation` = `>= cut`; dos ejecuciones **independientes** (evaluación arranca con el capital inicial completo) + deltas `evaluation − development`.                |

## Contratos propuestos

```ts
// T1 — huella reproducible de la definición (§12C)
// src/domain/strategies/fingerprint.ts
export function canonicalJson(value: unknown): string // props propios ordenados, recursivo, sin funciones
export function strategyFingerprint(strategy: Strategy): string // FNV-1a hex estable
// Experiment gains: readonly fingerprint: string

// T2 — cierre opcional + instrumento registrado (§12C)
interface BacktestConfig {
  // ...los actuales...
  /** Instrumento registrado en el experimento; no interviene en la ejecución. */
  instrument?: Instrument
  /** Cierra la posición abierta al cierre de la última vela (por defecto false). */
  closePositionAtEnd?: boolean
}

// T3 — test-forward (§7C)
// src/domain/backtest/split.ts
export class SplitError extends DomainError {}
export interface CandleSplit {
  cutTime: number
  development: readonly Candle[] // time < cutTime
  evaluation: readonly Candle[] // time >= cutTime
}
export function splitCandles(candles: readonly Candle[], cutTime: number): CandleSplit

// src/domain/backtest/testForward.ts
export interface TestForwardConfig extends BacktestConfig {
  cutTime: number
}
export interface TestForwardRun {
  cutTime: number
  development: Experiment
  evaluation: Experiment
  /** evaluation − development por métrica; ausente si alguno de los dos es null. */
  deltas: Partial<Record<keyof Metrics, number>>
}
export function runTestForward(config: TestForwardConfig): TestForwardRun

// T4 — snapshot serializable + repositorio (§9/§12C)
// src/domain/backtest/experiment.ts (ampliar)
export interface ExperimentSnapshot {
  /** Hash determinista del contenido (sin id): misma config + resultado → mismo id. */
  id: string
  strategyId: string // "name@version"
  fingerprint: string
  instrument: string | null // "BTC/USDT" o null si no se registró
  timeframe: string // code, p. ej. "1h" (se reconstruye con Timeframe.from)
  period: { from: number; to: number }
  initialCapital: number
  execution: Required<ExecutionModelConfig>
  risk: Required<RiskConfig>
  metrics: Metrics
  finalEquity: number
  equityCurve: readonly EquityPoint[]
  trades: readonly Trade[] // roundtrip vía toJSON / Trade.from
}
// Sin orders ni events (decisión cerrada). Sin savedAt: el snapshot es puro.
export class Experiment {
  toSnapshot(): ExperimentSnapshot
}

// src/storage/experimentRepository.ts (mismo patrón que CandleRepository)
export class ExperimentRepository {
  constructor(storage: Storage)
  save(snapshot: ExperimentSnapshot): void // clave `experiments:<id>` (overwrite)
  list(): ExperimentSnapshot[] // period.from descendente; empate por id ascendente
  find(id: string): ExperimentSnapshot | null
  remove(id: string): boolean
  clear(): void
}

// T5 — comparación de experimentos (§9)
// src/domain/backtest/compare.ts
export type ComparisonField =
  'instrument' | 'timeframe' | 'period' | 'initialCapital' | 'execution' | 'risk'
export interface ComparisonRow {
  id: string
  strategyId: string
  instrument: string | null
  timeframe: string
  period: { from: number; to: number }
  initialCapital: number
  metrics: Metrics
  finalEquity: number
}
export interface ComparisonTable {
  rows: readonly ComparisonRow[]
  /** Campos que varían entre filas → aviso de no-comparabilidad directa (§12C). */
  differences: readonly ComparisonField[]
}
export function compareExperiments(snapshots: readonly ExperimentSnapshot[]): ComparisonTable
/** Ordena desc por métrica; `null` al final; orden estable. */
export function rankBy(
  rows: readonly ComparisonRow[],
  metric: keyof Metrics,
): readonly ComparisonRow[]

// T6 — optimización por rejilla (§13)
// src/domain/backtest/optimization.ts
export type StrategyFactory = (params: Readonly<Record<string, number>>) => Strategy
export class OptimizationError extends DomainError {}
export interface OptimizationConfig {
  buildStrategy: StrategyFactory
  /** Nombre → valores; combinaciones en orden lexicográfico siguiendo el orden de claves. */
  grid: Readonly<Record<string, readonly number[]>>
  /** Métrica a optimizar (mayor es mejor; nulls al final). */
  metric: keyof Metrics
  /** BacktestConfig sin `strategy`. */
  base: Omit<BacktestConfig, 'strategy'>
}
export interface OptimizationRun {
  params: Readonly<Record<string, number>>
  metrics: Metrics
  finalEquity: number
  tradeCount: number
}
export interface OptimizationResult {
  grid: Readonly<Record<string, readonly number[]>>
  metric: keyof Metrics
  runs: readonly OptimizationRun[] // orden lexicográfico estable
  best: OptimizationRun
  worst: OptimizationRun
}
export const MAX_OPTIMIZATION_RUNS = 1000
export function runOptimization(config: OptimizationConfig): OptimizationResult

// T7 — robustez / sensibilidad (§13)
// src/domain/backtest/robustness.ts
export interface SensitivityEntry {
  param: string
  /** max − min de la media de la métrica al variar esa dimensión (efecto principal). */
  spread: number
}
export interface RobustnessReport {
  metric: keyof Metrics
  /** Ejecuciones con la métrica no null (las null se excluyen de las estadísticas). */
  count: number
  best: number
  worst: number
  mean: number
  stdev: number
  /** Vecindario directo del mejor (±1 paso en exactamente una dimensión de la rejilla). */
  plateau: { neighbors: number; avg: number | null; worst: number | null }
  /** Fracción de ejecuciones con métrica > threshold (umbral literal, por defecto 0). */
  aboveThreshold: { threshold: number; count: number; fraction: number }
  /** Dimensiones ordenadas por spread descendente: cuánto influye cada parámetro. */
  sensitivity: readonly SensitivityEntry[]
}
export function analyzeRobustness(
  result: OptimizationResult,
  options?: { threshold?: number },
): RobustnessReport
```

## Tareas (TDD: firma + tests en rojo → implementación → verde → gates)

### T0 — Corrección de alcance en la documentación

- **Archivos:** `AGENTS.md`, `docs/proyectstate.md` (sin tests).
- `AGENTS.md` §13 Fase 6: "Gestión de múltiples estrategias y capital." → modelo real
  ("un experimento = una estrategia + su propio capital; la comparación es entre experimentos").
- `AGENTS.md` §8: eliminar "Asignación de capital entre estrategias" y sustituir el ejemplo de las
  dos señales conjuntas de BTC por evaluación de riesgo **dentro** de un experimento; revisar §5
  (`TradingEngine: coordinación de múltiples estrategias`) y menciones similares.
- `proyectstate.md` pendiente Fase 6: misma corrección.
- **Aceptación:** ninguna doc afirma capital compartido entre estrategias (grep `múltiples
estrategias`, `Asignación de capital` sin resultados contradictorios).

### T1 — Fingerprint de estrategia (§12C)

- **Archivos:** `src/domain/strategies/fingerprint.ts` ↔ `test/domain/strategies/fingerprint.test.ts`
  (+ `experiment.test.ts` ampliado).
- `canonicalJson`: recorre `name`, `version`, `indicators`, `signals`, `invalidationRule`
  serializando solo **props propios enumerables** con claves ordenadas alfabéticamente; arrays
  conservan orden; sin funciones ni `constructor.name` (la minificación lo rompería).
- `strategyFingerprint` = FNV-1a sobre el JSON canónico → hex (detección de cambios, no
  seguridad criptográfica). `Experiment` pasa a registrar `fingerprint`.
- **Aceptación:** misma definición reconstruida → misma huella; cualquier cambio (periodo, orden de
  señales, regla, versión) → huella distinta; estable entre ejecuciones.

### T2 — Cierre opcional de posición abierta (pendiente de Fase 4)

- **Archivos:** `src/domain/backtest/backtest.ts` ↔ `test/domain/backtest/backtest.test.ts`
  (+ `experiment.test.ts`).
- `closePositionAtEnd` (default `false`): si queda posición abierta al terminar el bucle, se emite
  una venta a mercado **rellenada al cierre de la última vela** con los mismos costes
  (slippage/fee) que el modelo de ejecución, generando el `Trade` correspondiente. Esto es una
  excepción al relleno "al siguiente open" (no hay vela siguiente): documentar en el código.
- `instrument` opcional en la config, registrado por `Experiment` (habilita comparación de activos).
- **Aceptación:** default `false` → resultados idénticos a hoy (regresión); `true` → `position`
  null, `Σ trades.pnl = finalEquity − initialCapital` (con costes de cierre), sin la opción nada
  cambia.

### T3 — Split y Test-Forward (§7C)

- **Archivos:** `src/domain/backtest/split.ts`, `testForward.ts` ↔ tests espejo.
- `splitCandles`: corte por tiempo; `cutTime` debe ser **estrictamente interior** (≥ 1 vela en cada
  lado) o `SplitError`; valida velas ascendentes/no vacías.
- `runTestForward`: divide y ejecuta dos `Experiment` **independientes** con la misma estrategia y
  configuración (la evaluación arranca con `initialCapital` completo, sin heredar nada del
  desarrollo); calcula `deltas` (eval − dev) de las 8 métricas, ausentes si alguno es `null`.
- **Aceptación:** cada experimento solo ve sus propias velas (anti look-ahead heredado);
  determinismo (§12C); errores con corte fuera de rango o sin velas a un lado.

### T4 — Snapshot y repositorio de experimentos (persistencia, §9/§12C)

- **Archivos:** `src/domain/backtest/experiment.ts` (`toSnapshot`) ↔ `experiment.test.ts`;
  `src/storage/experimentRepository.ts` ↔ `test/storage/experimentRepository.test.ts`.
- `ExperimentSnapshot` (contrato arriba): sin `orders`/`events`; `Trade` con `toJSON`/`Trade.from`
  para roundtrip; `id` = hash (reutilizando `canonicalJson` de T1) del snapshot sin `id`.
- `ExperimentRepository` con `Storage` inyectado (mismo patrón que `CandleRepository`); JSON
  corrupto o snapshot inválido → error de dominio (`CorruptedStorageError` reutilizado o
  equivalente); clave `experiments:<id>`.
- **Aceptación:** `save → list → find` roundtrip `toEqual`; mismo experimento dos veces → mismo
  `id` y **una sola** entrada; `remove`/`clear` correctos; orden de `list` determinista.

### T5 — Comparación de experimentos (§9)

- **Archivos:** `src/domain/backtest/compare.ts` ↔ `test/domain/backtest/compare.test.ts`.
- `compareExperiments`: filas con metadata + 8 métricas + `finalEquity`; `differences` = campos que
  varían entre filas (estrategia **no** se incluye: variarla es el objeto de comparar).
- `rankBy`: orden descendente por métrica, `null` al final, orden estable (empates conservan el
  orden de entrada).
- **Aceptación:** 0 o 1 snapshot → `differences` vacío; ≥ 2 → campos variados correctos; ranking
  con métricas null y empates estable; determinismo.

### T6 — Optimización por rejilla (§13)

- **Archivos:** `src/domain/backtest/optimization.ts` ↔ `test/domain/backtest/optimization.test.ts`.
- Producto cartesiano en orden lexicográfico (orden de claves declarado); valida `values` no
  vacías y `total ≤ MAX_OPTIMIZATION_RUNS` (si no, `OptimizationError`); error de `buildStrategy` o
  de la ejecución → `OptimizationError` con los `params` del combo (aborta, determinista).
- Cada run registra `params`, `metrics`, `finalEquity`, `tradeCount` (**no** `orders`/`events`:
  memoria). `best`/`worst` = extremos por `metric` con `nulls` al final.
- **Aceptación:** mismo grid → mismos runs (orden y resultados, §12C); combinaciones completas y
  sin duplicados; cap respetado; `best` coherente con `rankBy`.

### T7 — Análisis de robustez / sensibilidad (§13)

- **Archivos:** `src/domain/backtest/robustness.ts` ↔ `test/domain/backtest/robustness.test.ts`.
- Estadísticas sobre runs con métrica no null (`count` puede ser < `runs.length`; sin ninguno →
  `OptimizationError`/`RobustnessError`); `plateau` = vecinos ±1 paso en una sola dimensión
  (menos vecinos en los bordes de la rejilla); `sensitivity` = efecto principal por dimensión
  (media de la métrica fijando cada valor del parámetro, `spread` = max − min, orden descendente).
- **Aceptación:** vecindario correcto en esquinas/caras; nulls excluidos de stats pero incluidos en
  `neighbors`; caso rejilla 1×N; umbral configurable; determinismo.

### T8 — UI mínima

- **Archivos:** `src/components/ExperimentHistoryPanel.tsx`, `TestForwardPanel.tsx`,
  `OptimizationPanel.tsx`, `backtestForm.ts` (extraído de `BacktestPanel`: `Params`, `validate`,
  defaults, compartido por los paneles con formulario) ↔ tests espejo en `test/components/` +
  ajustes en `BacktestPanel.tsx` y `App.tsx`.
- **Historial:** lista `ExperimentSnapshot` (estrategia, instrumento, timeframe, periodo, ROI),
  selección múltiple → `compareExperiments` + selector de métrica para `rankBy` → tabla comparada
  con avisos de `differences`; borrar selección/todo.
- **Test-forward:** fecha de corte (validada dentro del rango de velas) + parámetros → `runTestForward`
  → tablas dev/eval lado a lado + fila de deltas.
- **Optimización:** rangos de SMA rápida/lenta (desde/hasta/paso) + métrica → aviso si las
  combinaciones superan el cap **antes** de ejecutar → tabla de runs ordenada por `rankBy` +
  bloque de `RobustnessReport` (mejor, media, desv, plateau, sensibilidad).
- **BacktestPanel:** prop `instrument`, checkbox _Cerrar posición al final_, auto-guardo vía
  `onExperiment(experiment)` → `App` guarda `toSnapshot()`. **App:** `ExperimentRepository` en
  `localStorage`, estado de snapshots, subtítulo "Fase 6".
- **Aceptación:** validaciones de inputs (enteros ≥ 1, fechas, cap); sin velas → aviso y botón
  deshabilitado, sin crash; ejecutar pinta resultados y actualiza el historial; smoke en
  `App.test.tsx`.

### T9 — E2E, docs y cierre de fase

- **Archivos:** E2E de laboratorio (`test/domain/backtest/laboratorioE2E.test.ts` o test de
  integración equivalente) + docs.
- Escenario completo sobre una serie conocida: backtest → snapshot → `splitCandles` +
  `runTestForward` (deltas verificados a mano) → `runOptimization` (rejilla pequeña) →
  `analyzeRobustness` → `compareExperiments` con `differences`; determinismo extremo a extremo.
- Actualización de `proyectstate.md` (Fase 6 completa + contadores), `domain-diagram-phase3.md`
  (módulos nuevos en `backtest/`, repositorio en `storage/`) y este plan (estado completado).
- **Aceptación (gate de fase):** `pnpm test && pnpm typecheck && pnpm format:check` en verde y
  `pnpm build` compila.

## Orden y dependencias

```
T0 Docs (corrección de alcance)

T1 Fingerprint ─→ T2 Cierre al final ─→ T4 Snapshot+Repo ─→ T5 Comparación ─→ T3 Test-Forward ─┐
T6 Optimización ─→ T7 Robustez ────────────────────────────────────────────────────────────────┼→ T8 UI ─→ T9 E2E/docs
```

Las dos ramas (persistencia/comparación y optimización/robustez) son independientes entre sí y
pueden alternarse; T3 cierra la rama de dominio porque reutiliza el patrón de deltas de T5.
Cada tarea es una ronda TDD con el gate en verde antes de la siguiente. Como en fases previas
(AGENTS.md §Git): **el agente no hace commits** — al terminar cada tarea se **sugiere un mensaje de
commit** para quien gestione el repo.

## Fuera de alcance (queda para después)

- **Fase 5 — Replay interactivo** (sigue pendiente; independiente de esta fase).
- **Capital compartido / multi-estrategia**: no aplica al producto (corregido en T0).
- Walk-forward, muestreo aleatorio con semilla y optimización evolutiva.
- Persistencia de **definiciones** de estrategia → re-ejecutar experimentos guardados desde cero
  (transversal pendiente; el snapshot conserva `fingerprint` pero no la definición reconstruible).
- Guardar resultados de optimización (runs individuales) en localStorage.
- Resto de métricas §9: Sortino, tiempo medio en posición, exposición media.
- UI rica: heatmap de parámetros, equity curves superpuestas, trades sobre el gráfico.
- Indicadores restantes (MACD, ATR, Bollinger, VWAP), editor de estrategias, paginación de rangos.

## Puntos abiertos

1. **Rendimiento O(n²)** (heredado de Fase 4) × hasta 1000 runs de optimización. **Mitigación:**
   `MAX_OPTIMIZATION_RUNS = 1000`. **Disparador:** optimización perceptiblemente lenta → cálculo
   incremental de indicadores (el disparador ya apuntado en Fase 4).
2. **Auto-guardo vs botón "Guardar"**: se elige auto-guardo (el id determinístico deduplica). Si el
   historial se satura con series distintas → añadir guardado explícito.
3. **Comparar periods distintos**: se permite con aviso (`differences`). Si resulta confuso → exigir
   periodo común para comparar (cambio de un solo sitio: `compareExperiments`).
4. **Deltas con `null`**: ausentes del objeto (no se inventa `0`); la UI muestra "—".
5. **Cierre al final con costes**: el cierre paga fee/slippage → `finalEquity` difiere del marcado a
   mercado; es el comportamiento esperado y testeado en T2.

### Resueltos durante la implementación

- _(pendiente)_
