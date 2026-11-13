# Estado del proyecto

> Resumen de implementado y lo pendiente. Fuente de verdad de requisitos: [`AGENTS.md`](../AGENTS.md)
> (arquitectura y fases) y [`refactors-no-realizados.md`](./refactors-no-realizados.md) (refactors aplazados).
>
> Última actualización: 2026-11-13 — `pnpm test && pnpm typecheck && pnpm format:check` en verde
> (**788 tests**, 63 archivos). `pnpm build` compila sin errores.

## Qué hay

App de estrategias de trading de criptomonedas: React + TypeScript, lógica en el navegador, datos de
una API pública de exchange (Binance) y persistencia local. Existe el **dominio puro** (velas,
instrumentos, indicadores, estrategias), el **repositorio de velas**, la **capa de API**, la UI de la
Fase 1 (gráfica de velas con indicadores e importación), la **ejecución simulada de la Fase 3**
(órdenes, posiciones, portfolio, riesgo, broker y runner), el **backtesting de la Fase 4** (motor,
métricas, experimentos y panel de UI), la **simulación interactiva de la Fase 5** (motor de
reproducción compartido, replay con estados, operaciones manuales y panel con gráfico recortado) y
la **experimentación avanzada de la Fase 6** (test-forward, comparación, optimización por rejilla,
robustez y persistencia de experimentos).

## Implementado

### Fase 1 — Datos y gráficos (completa)

| Módulo                                                               | Archivos                                       | Tests                 |
| -------------------------------------------------------------------- | ---------------------------------------------- | --------------------- |
| Modelo de velas                                                      | `src/domain/candles/candle.ts`, `timeframe.ts` | 45 + 7                |
| Agregación de velas                                                  | `src/domain/candles/aggregate.ts`              | 6                     |
| Normalización de respuestas del exchange                             | `src/domain/candles/normalize.ts`              | 7                     |
| Posición de precio en la vela                                        | `src/domain/candles/pricePosition.ts`          | (en `candle.test.ts`) |
| Importación de CSV (parser puro texto → `Candle[]`)                  | `src/domain/candles/csv.ts`                    | 18                    |
| Modelo de instrumentos (`BTC/USDT`, internado, `exchangeSymbol`)     | `src/domain/instruments/instrument.ts`         | 21                    |
| Almacenamiento y consultas (`CandleRepository`, `Storage` inyectado) | `src/storage/candleRepository.ts`              | 17                    |
| **Capa de API** (`MarketDataProvider`, `BinanceProvider`)            | `src/api/**`                                   | 15                    |
| **Gráficos de velas + volumen + indicadores**                        | `src/components/CandleChart.tsx`               | 14                    |
| **UI de la Fase 1** (App, controles, importación, panel indicadores) | `src/components/*.tsx`                         | 64                    |

### Fase 1 — detalle de la UI

| Componente           | Responsabilidad                                                                   |
| -------------------- | --------------------------------------------------------------------------------- |
| `App.tsx`            | Orquesta estado, repositorio y proveedor; no contiene lógica de dominio           |
| `CandleChart.tsx`    | `lightweight-charts`: velas, volumen overlay, líneas de indicador, leyenda OHLCV  |
| `DataControls.tsx`   | Instrumento (con sugerencias), timeframe, rango de fechas, botón de descarga      |
| `CsvImportPanel.tsx` | Lectura de `File` → `CsvCandlesImporter` → entrega de velas validadas             |
| `IndicatorPanel.tsx` | Activación y periodo de SMA/EMA/RSI (valida enteros ≥ 1)                          |
| `chartData.ts`       | Mappers puros a datos de lightweight-charts + `buildLines` + ajustes de indicador |

El arranque es `src/main.tsx` (fija `CandleRepository(localStorage)` y `BinanceProvider`), servido
por `index.html` + `vite.config.ts`. Comandos: `pnpm dev`, `pnpm build`, `pnpm preview`.

### Fase 2 — Dominio de estrategias (completa)

| Módulo                                                                                                                                                                                                        | Archivos                                    | Tests |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- |
| `MarketContext` — qué ve la estrategia, sin look-ahead                                                                                                                                                        | `src/domain/strategies/marketContext.ts`    | 15    |
| Reglas — `CrossesAbove/Below`, `Greater/Lower`, `All/Any/Not` (con núcleos `Crosses`/`Comparison`/`Logical`), `resolveRef`                                                                                    | `src/domain/strategies/rules.ts`            | 19    |
| `Strategy` + `Signal` — señales priorizadas (`RequestEntry`/`RequestAdd`/`RequestReduce`/`RequestExit`), `limitPrice` por alias, regla de invalidación (veto → `Invalidate`), versionado `name@version`       | `src/domain/strategies/strategy.ts`         | 34    |
| `StrategyInstance` — máquina de estados `WaitingForSignal → WaitingForEntryFill → WaitingForExitSignal → WaitingForExitFill`, eventos de dominio (`StrategyConfirmed`, `PositionOpened`, …), `apply`/`onFill` | `src/domain/strategies/strategyInstance.ts` | 32    |

### Indicadores (reutilizables por gráfico y estrategias)

`src/domain/indicators/` — contrato `Indicator`/`IndicatorValue` + `Sma`, `Ema`, `Rsi` (Wilder), con
`null` durante el calentamiento y salida alineada con las velas. 27 tests.

### Resultado de Fase 2 cumplido

Se pueden **definir y evaluar estrategias sin ejecutar operaciones**: reglas puras, decisiones
(`request_entry`/`request_add`/`request_reduce`/`request_exit`/`none`/`invalidate`) con fracción y
precio objetivo, y ciclo de vida de la instancia con eventos. El estado `Profit`/`Loss` de AGENTS.md
se queda para Fase 3 (requiere P&L de posiciones reales/simuladas).

### Fase 3 — Ejecución simulada (completa)

Plan detallado: [`fase3-plan.md`](./fase3-plan.md). Sin UI (visualización, Fase 4); long-only.

| Módulo                                                                                                                                   | Archivos                                                              | Tests |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| `Order` — side/type/qty/price, transiciones `Pending → Filled/Cancelled/Rejected`                                                        | `src/domain/execution/order.ts`                                       | 24    |
| `Fill` + `ExecutionModel` (`NextOpenExecutionModel`: apertura siguiente, slippage, fee, límite tocado)                                   | `src/domain/execution/fill.ts`, `executionModel.ts`                   | 14+16 |
| `Position` (long-only) — coste unitario **con fees**, P&L realizado, `unrealizedPnl`                                                     | `src/domain/execution/position.ts`                                    | 12    |
| `Portfolio` (§8) — invariante `cash >= 0`, `equity`, exposición, realizado/comisiones acumulados                                         | `src/domain/portfolio/portfolio.ts`                                   | 14    |
| `RiskManager` (§8) — `entryQty`/`addQty`/`canAdd`, reserva de efectivo, tope de exposición, fee+slippage estimados, qty con 12 decimales | `src/domain/portfolio/riskManager.ts`                                 | 26    |
| `Broker` (interfaz §6) + `HistoricalBroker` + puerto `Account` — avance por vela, rechazos controlados, cancelación                      | `src/domain/execution/broker.ts`, `historicalBroker.ts`, `account.ts` | 16    |
| `StrategyRunner` — decide → envía orden → rellena → actualiza instancia; `ExecutionEvent[]`                                              | `src/domain/trading/strategyRunner.ts`                                | 16    |
| E2E: cruce de SMA con fees/slippage, anti look-ahead explícito, determinismo, veto con orden pendiente                                   | `test/domain/trading/runnerIntegration.test.ts`                       | 5     |

**Invariante anti look-ahead** (central, testeado): en cada vela el runner primero avanza el broker
(rellena órdenes decididas antes) y después evalúa; una orden decidida en la vela N solo rellena en
N+1. Los rechazos del broker emiten `OrderRejected` y la señal viva reenvía la orden. Los eventos de
ejecución (`OrderSubmitted/Filled/Rejected/Cancelled`) se devuelven junto a los `StrategyEvent`
existentes (§12D); la máquina de estados no cambió.

**Sin ciclos entre paquetes**: `HistoricalBroker` depende del puerto `Account`
(`src/domain/execution/account.ts`, efectivo/posición/`applyFill`) en vez de `Portfolio`, con lo que
la dependencia va en un solo sentido `portfolio → execution` (ver [`domain-diagram-phase3.md`](./domain-diagram-phase3.md)).

**Resultado de Fase 3 cumplido:** una estrategia puede generar operaciones y gestionar posiciones de
forma determinista y reproducible, sin conocer backtest, replay ni React (§14). El P&L `Profit`/`Loss`
queda resuelto vía `Position`/`Portfolio` (decisión de alcance, ver plan).

### Fase 4 — Backtesting (completa)

Plan detallado: [`fase4-plan.md`](./fase4-plan.md). Decisiones de alcance: UI mínima (panel con
estrategia demo de cruce SMA, sin trades sobre el gráfico), 8 métricas (§9 mínimo), experimentos en
memoria (persistencia → Fase 6) y ≤ 1000 velas (sin paginación).

| Módulo                                                                                                          | Archivos                                                                         | Tests |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----- |
| `MarketClock` (§12A) — tiempo de simulación estrictamente creciente, sin `Date.now`                             | `src/domain/time/marketClock.ts`                                                 | 12    |
| `Trade` — un registro por cierre (parcial/total), pnl neto; `Σ pnl = realizedPnl`                               | `src/domain/backtest/trade.ts`                                                   | 16    |
| `RecordingBroker` — decorador de `Broker`: registra órdenes y construye trades con el snapshot **previo**       | `src/domain/backtest/recordingBroker.ts`                                         | 9     |
| Métricas §9 (mínimo): Net Profit, ROI, Max DD, Sharpe, Profit Factor, Win Rate, Avg Trade, Expectancy           | `src/domain/backtest/metrics.ts`                                                 | 16    |
| `runBacktest` — ejecución automática (Portfolio + Risk + Broker + Runner + Clock), determinista                 | `src/domain/backtest/backtest.ts`                                                | 7     |
| `Experiment` (§9/§12C) — registro completo: `name@version`, periodo, capital, ejecución y riesgo                | `src/domain/backtest/experiment.ts`                                              | 6     |
| E2E: 8 métricas a mano, invariantes y determinismo de extremo a extremo                                         | `test/domain/backtest/experimentE2E.test.ts`                                     | 3     |
| UI mínima: `BacktestPanel` (parámetros, métricas, trades) + `EquityChart` + mapper de equity + E2E desde la app | `src/components/BacktestPanel.tsx`, `EquityChart.tsx`, `chartData.ts`, `App.tsx` | 15    |

**Invariantes de fase:** anti look-ahead heredado del runner (orden de la vela N rellena en N+1);
`Σ trades.pnl = finalEquity − inicial` con posición cerrada; misma config → mismo resultado (§12C).
El Sharpe es `media/desv de retornos por vela × √(año/timeframe)` sin riesgo libre (±∞ con varianza
0; `null` con < 2 retornos o equity plano).

### Fase 5 — Simulación interactiva (completa)

Plan detallado: [`fase5-plan.md`](./fase5-plan.md). Decisiones de alcance: velocidad en **tiempo
real** (1× = `timeframe.ms`, presets 0.5×–3600×, clamp `[16 ms, 1 h]`), operaciones manuales por
fracción con sizing de `RiskManager` (**orden única en vuelo** global), log en panel (últimas 100
entradas) + `CandleChart` **recortado** a las velas consumidas (velas e indicadores), sin métricas
ni equity en vivo (sigue siendo trabajo del backtest) y con la demo `sma-cross` (sin editor de
estrategias).

| Módulo                                                                                                                                               | Archivos                                    | Tests |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- |
| `TradingSession` — motor de reproducción compartido (§7): stack de Fase 3 vela a vela; `findConfigProblem` se muda aquí (re-export en `backtest.ts`) | `src/domain/trading/tradingSession.ts`      | 11    |
| `MarketReplayEngine` — estados `ready/playing/finished`, `step`/`reset`, manuales por fracción, log por paso (§7B/§12D)                              | `src/domain/replay/replayEngine.ts`         | 21    |
| Velocidad `replayIntervalMs` — multiplicador en tiempo real, acotada (§7B)                                                                           | `src/domain/replay/speed.ts`                | 5     |
| `RecordingBroker.fills` — payload de rellenos para el log (§12D)                                                                                     | `src/domain/backtest/recordingBroker.ts`    | +3    |
| `runBacktest` — refactor a bucle sobre `TradingSession` (mismo comportamiento, sin tocar sus tests)                                                  | `src/domain/backtest/backtest.ts`           | —     |
| UI: `ReplayPanel` (transporte, velocidad, manuales, log) + `App` con `replayCursor` y gráfico recortado                                              | `src/components/ReplayPanel.tsx`, `App.tsx` | 16    |
| E2E: replay paso a paso ≡ backtest, manuales con invariantes, reset §12C, cierre manual                                                              | `test/domain/replay/replayE2E.test.ts`      | 4     |

**Invariantes de fase:** anti look-ahead heredado del runner (también para manuales: orden de la
vela N rellena en N+1); **motor único** — una sesión paso a paso produce los mismos
`trades`/`equityCurve`/`events`/`finalEquity` que `runBacktest`; orden única en vuelo preserva
`Σ trades.pnl = realizedPnl` (≤ 1 fill por vela); `reset()` → mismo recorrido (§12C).

### Fase 6 — Experimentación avanzada (completa)

Plan detallado: [`fase6-plan.md`](./fase6-plan.md). Decisiones de alcance: **T0** corrige
`AGENTS.md` (el modelo real es _un experimento = una estrategia + su propio capital_, sin capital
compartido), UI mínima (3 paneles), **grid search determinista** (sin walk-forward), persistencia
en localStorage con **id determinístico** (re-ejecutar = overwrite) y optimización **sin** guardar
runs individuales.

| Módulo                                                                                                                         | Archivos                                           | Tests |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----- |
| `canonicalJson`/`strategyFingerprint`/`canonicalHash` — huella reproducible de definición y de contenido (§12C)                | `src/domain/strategies/fingerprint.ts`             | 11    |
| Cierre opcional `closePositionAtEnd` + `instrument` en la config del backtest (pendiente de Fase 4)                            | `src/domain/backtest/backtest.ts`, `experiment.ts` | +6    |
| `Trade.toJSON/from` — roundtrip de persistencia validado                                                                       | `src/domain/backtest/trade.ts`                     | +3    |
| `ExperimentSnapshot` + `toSnapshot()` — id = hash del contenido **sin** id, sin orders/events                                  | `src/domain/backtest/experiment.ts`                | +4    |
| `ExperimentRepository` — `Storage` inyectado, clave `experiments:<id>`, orden determinista; `CorruptedStorageError` compartido | `src/storage/experimentRepository.ts`, `errors.ts` | 9     |
| `splitCandles` + `runTestForward` — test-forward con deltas `eval − dev` (§7C)                                                 | `src/domain/backtest/split.ts`, `testForward.ts`   | 12    |
| `compareExperiments`/`rankBy` + `sortByMetricDesc` como semántica única de ordenación (§9)                                     | `src/domain/backtest/compare.ts`, `metrics.ts`     | 10    |
| `runOptimization` — producto cartesiano lexicográfico, cap 1000, `best`/`worst` (§13)                                          | `src/domain/backtest/optimization.ts`              | 11    |
| `analyzeRobustness` — estadísticas, `plateau`, umbral y `sensitivity` (§13)                                                    | `src/domain/backtest/robustness.ts`                | 11    |
| UI: `backtestForm` compartido + `ExperimentHistoryPanel` + `TestForwardPanel` + `OptimizationPanel` + auto-guardo en `App`     | `src/components/*.tsx`, `backtestForm.ts`          | 36    |
| E2E de laboratorio: backtest → snapshot → test-forward → optimización → robustez → comparación, deltas verificados a mano      | `test/domain/backtest/laboratorioE2E.test.ts`      | 5     |

**Invariantes de fase:** determinismo **extremo a extremo** (el pipeline completo del E2E se repite
idéntico, §12C); `id` estable → mismo experimento = una sola entrada; deltas con `null` **ausentes**
(no se inventa `0`); cap de rejilla avisado **antes** de ejecutar; cada experimento opera con su
propio capital (corrección T0) y la comparación es entre experimentos.

### Mejora UI — sidebar colapsable y pestañas del área principal (completa)

Plan detallado: [`ui-plan.md`](./ui-plan.md). Decisiones: **acordeón de 3 secciones** en el sidebar
(Datos · Experimentos · Resultados) con una sola abierta por defecto (`Datos`), paneles plegados
**sin desmontar** (el estado de replay/formularios/resultados sobrevive), sección abierta
persistida en `localStorage` (`ui:sidebar-section`, fallo tolerado), y conmutador de vista **por
estado** (sin router) con pestañas `Gráfico | Backtest` en el área principal: un backtest con éxito
auto-conmuta a su pestaña y los resultados (métricas, equity curve, trades) se muestran **a ancho
completo** fuera de los 300px del sidebar.

| Módulo                                                                                              | Archivos                                                 | Tests                         |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| `SidebarSection` — acordeón con `aria-expanded`/`aria-controls`; contenido con `hidden` (montado)   | `src/components/SidebarSection.tsx`                      | 6                             |
| `sidebarState` — sección abierta persistida con `Storage` inyectado, fallo → no-op                  | `src/storage/sidebarState.ts`                            | 5                             |
| `MainTabs` — pestañas `Gráfico                                                                      | Backtest`(roles`tablist`/`tab`, indicador de resultados) | `src/components/MainTabs.tsx` | 4   |
| `BacktestResults` — resultados en el área principal (rejilla métricas + equity, trades con scroll)  | `src/components/BacktestResults.tsx`                     | 4                             |
| Split `BacktestPanel` (solo formulario + `onResult`) y `App` (acordeón, pestañas, auto-conmutación) | `src/components/BacktestPanel.tsx`, `App.tsx`            | +2                            |

**Fase 3 del plan UI (pendiente):** mover Replay, Optimización, Test-Forward e Historial al área
principal con el mismo `MainTabs` (el mecanismo ya existe).

## Pendiente

### Inmediato (siguiente paso natural)

- **Capa de datos más allá de Binance**: más proveedores, detección de huecos/duplicados a nivel de
  serie y paginación de rangos que superen `MAX_CANDLES` (hoy un rango largo devuelve como máximo
  1000 velas por petición, sin paginar).
- **Indicadores restantes**: MACD, ATR, Bollinger, VWAP (el contrato `Indicator` ya los admite;
  `buildLines` y `IndicatorPanel` solo hay que ampliarlos).

### Transversales pendientes

- **Persistencia de estrategias**: los **resultados** de experimentos ya se guardan
  (`ExperimentRepository`, Fase 6); falta guardar las **definiciones** (con su versión) para
  re-ejecutarlas desde cero.
- **Eventos y observabilidad (§12D)**: los eventos se devuelven en las transiciones pero no hay
  despacho/suscripción; el log del replay los consume por diff del `RecordingBroker` (Fase 5).
- **Indicadores restantes**: MACD, ATR, Bollinger, VWAP (el contrato `Indicator` ya los admite).
- **Versionado automático**: hoy `version` es manual en `StrategyDefinition`; el fingerprint
  reproducible de `Experiment` ya existe (Fase 6), falta derivar `version` de la definición.
- **Market Data completo (§2)**: detección de huecos/duplicados a nivel de serie, agregación desde
  menor granularidad (la fusión existe), importación de más formatos, paginación de rangos largos.
- **Serie temporal de la UI**: no hay paginación ni "cargar más"; el gráfico muestra hasta
  `MAX_CANDLES` velas por pareja (instrumento, timeframe).

## Convención de trabajo

TDD en rondas: firmas + tests en rojo → implementación → los tres comandos en verde:

```bash
pnpm test && pnpm typecheck && pnpm format:check
```
