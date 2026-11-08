# Estado del proyecto

> Resumen de lo implementado y lo pendiente. Fuente de verdad de requisitos: [`AGENTS.md`](../AGENTS.md)
> (arquitectura y fases) y [`refactors-no-realizados.md`](./refactors-no-realizados.md) (refactors aplazados).
>
> Última actualización: 2026-11-08 — `pnpm test && pnpm typecheck && pnpm format:check` en verde
> (**251 tests**, 15 archivos).

## Qué hay

App de estrategias de trading de criptomonedas: React + TypeScript, lógica en el navegador, datos de
una API pública de exchange y persistencia local. Hoy existe el **dominio puro** (velas, instrumentos,
indicadores, estrategias) y el **repositorio de velas**; todavía no hay UI, ni capa de API, ni
ejecución simulada.

## Implementado

### Fase 1 — Datos y gráficos (parcial: 4 de 5)

| Módulo                                                               | Archivos                                       | Tests                  |
| -------------------------------------------------------------------- | ---------------------------------------------- | ---------------------- |
| Modelo de velas                                                      | `src/domain/candles/candle.ts`, `timeframe.ts` | 45 + 10                |
| Agregación de velas                                                  | `src/domain/candles/aggregate.ts`              | 6                      |
| Normalización de respuestas del exchange                             | `src/domain/candles/normalize.ts`              | 7                      |
| Posición de precio en la vela                                        | `src/domain/candles/pricePosition.ts`          | (en `candle.test.ts`)  |
| Importación de CSV (parser puro texto → `Candle[]`)                  | `src/domain/candles/csv.ts`                    | 18                     |
| Modelo de instrumentos (`BTC/USDT`, internado, `exchangeSymbol`)     | `src/domain/instruments/instrument.ts`         | 21                     |
| Almacenamiento y consultas (`CandleRepository`, `Storage` inyectado) | `src/storage/candleRepository.ts`              | 17                     |
| **Gráficos de velas**                                                | —                                              | ⬜ **no implementado** |

### Fase 2 — Dominio de estrategias (completa)

| Módulo                                                                                                                                                                    | Archivos                                    | Tests |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- |
| `MarketContext` — qué ve la estrategia, sin look-ahead                                                                                                                    | `src/domain/strategies/marketContext.ts`    | 15    |
| Reglas — `CrossesAbove/Below`, `Greater/Lower`, `All/Any/Not`, `resolveRef`                                                                                               | `src/domain/strategies/rules.ts`            | 19    |
| `Strategy` + `Signal` — señales priorizadas (Enter/Add/Reduce/Exit), `limitPrice` por alias, regla de invalidación (veto → `Cancel`), versionado `name@version`           | `src/domain/strategies/strategy.ts`         | 34    |
| `StrategyInstance` — máquina de estados `Closed → Confirmed → Opened → Closing → Closed`, eventos de dominio (`StrategyConfirmed`, `PositionOpened`, …), `apply`/`onFill` | `src/domain/strategies/strategyInstance.ts` | 32    |

### Indicadores (reutilizables por gráfico y estrategias)

`src/domain/indicators/` — contrato `Indicator`/`IndicatorValue` + `Sma`, `Ema`, `Rsi` (Wilder), con
`null` durante el calentamiento y salida alineada con las velas. 27 tests.

### Resultado de Fase 2 cumplido

Se pueden **definir y evaluar estrategias sin ejecutar operaciones**: reglas puras, decisiones
(`enter`/`add`/`reduce`/`exit`/`hold`/`cancel`) con fracción y precio objetivo, y ciclo de vida de la
instancia con eventos. El estado `Profit`/`Loss` de AGENTS.md se queda para Fase 3 (requiere P&L de
posiciones reales/simuladas).

## Pendiente

### Inmediato (siguiente paso natural)

- **Gráficos de velas** (cierra Fase 1): decidir enfoque — `lightweight-charts` vs SVG propio;
  componentes React, volumen, zoom/navegación.
- **Capa `src/api/**`** ("historia #1" en `refactors-no-realizados.md`): cliente del exchange
  (`MarketDataProvider`), que además dispara el refactor F (mover `MAX_CANDLES` y
  `candleLimitForRange` de `timeframe.ts`).
- **UI de importación CSV**: lectura de `File` → texto → `CsvCandlesImporter.parse` (el parser ya
  existe; falta el componente y su test).

### Fase 3 — Ejecución simulada (AGENTS.md)

- Órdenes y posiciones (`Order`, `Position`, `Execution`).
- Broker simulado (`HistoricalBroker`/`PaperTradingBroker`) que consume las decisiones y confirma
  rellenos vía `StrategyInstance.onFill`.
- Comisiones, slippage, gestión de capital y riesgo básico (`Portfolio & Risk`).
- Estados `Profit`/`Loss` en la máquina de la estrategia.

### Fase 4 — Backtesting (AGENTS.md)

- `MarketClock` y Market Replay Engine (§12A) — tiempo de simulación determinista, compartido entre
  backtest y replay.
- Ejecución automática sobre datos históricos, registro de operaciones, métricas (`Results & Analytics`:
  Net Profit, ROI, Max Drawdown, Sharpe, …) y concepto de `Experiment` (§9).

### Fase 5 — Simulación interactiva

- Reproducción controlada por usuario: velocidad, pausa, paso a vela a vela; visualización de
  decisiones y eventos; operaciones manuales.

### Fase 6 — Experimentación avanzada

- Test-forward (separación datos de desarrollo/evaluación), comparación de estrategias, optimización
  de parámetros, análisis de robustez, múltiples estrategias y capital.

### Transversales pendientes

- **Application layer / UI**: no existe `src/components/` — la app aún no tiene pantalla.
- **Persistencia de estrategias**: solo hay `CandleRepository`; falta guardar definiciones (con su
  versión) y resultados.
- **Eventos y observabilidad (§12D)**: los eventos se devuelven en las transiciones pero no hay
  despacho/suscripción (gráfico, log).
- **Indicadores restantes**: MACD, ATR, Bollinger, VWAP (el contrato `Indicator` ya los admite).
- **Versionado automático**: hoy `version` es manual en `StrategyDefinition`; un fingerprint
  reproducible queda para `Experiment` (Fase 6).
- **Market Data completo (§2)**: detección de huecos/duplicados a nivel de serie, agregación desde
  menor granularidad (la fusión existe), importación de más formatos.

## Convención de trabajo

TDD en rondas: firmas + tests en rojo → implementación → los tres comandos en verde:

```bash
pnpm test && pnpm typecheck && pnpm format:check
```
