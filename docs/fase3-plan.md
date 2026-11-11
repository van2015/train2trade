# Plan de la Fase 3 — Ejecución simulada

> Desglose de tareas para la Fase 3 de [`AGENTS.md`](../AGENTS.md) (§6 Execution, §8 Portfolio & Risk):
> "una estrategia puede generar operaciones y gestionar posiciones".
>
> **Estado: completado (2026-11-11)** — T1…T8 implementados con TDD (ver `git log`: un commit por
> tarea), `pnpm test && pnpm typecheck && pnpm format:check` en verde (**479 tests**) y
> `proyectstate.md` actualizado. Requisitos: AGENTS.md §6/§8.

## Decisiones cerradas

| Decisión                | Elección                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alcance de posiciones   | **Solo largo** (long-only). Sin shorts, apalancamiento, funding ni liquidaciones.                                                                                                                     |
| Modelo de ejecución     | **Siguiente apertura**: market se rellena al `open` de la vela siguiente + slippage (bps); limit se rellena si la vela lo toca.                                                                       |
| Estados `Profit`/`Loss` | **No se añaden a la máquina**: el P&L (realizado y por marcar) vive en `Position`/`Portfolio`. La máquina queda `WaitingForSignal → WaitingForEntryFill → WaitingForExitSignal → WaitingForExitFill`. |
| UI                      | **Solo dominio**. Sin componentes nuevos; la visualización llega en Fase 4.                                                                                                                           |

## Contratos propuestos

```
src/domain/
├── execution/                → Fase 3 (nuevo)
│   ├── order.ts              → Order, OrderSide, OrderType, OrderStatus
│   ├── fill.ts               → Fill
│   ├── executionModel.ts     → ExecutionModel + NextOpenExecutionModel
│   ├── position.ts           → Position (long-only)
│   ├── broker.ts             → Broker (interfaz, §6)
│   └── historicalBroker.ts   → HistoricalBroker
├── portfolio/                → Fase 3 (nuevo)
│   ├── portfolio.ts          → cash, equity, exposición (§8)
│   └── riskManager.ts        → sizing y límites (§8)
└── trading/                  → Fase 3 (nuevo)
    └── strategyRunner.ts     → integra StrategyInstance + Risk + Broker
```

Interfaz del modelo de ejecución (el broker no conoce el mapeo decisión → orden; el runner no
conoce cómo se rellena):

```ts
interface ExecutionModel {
  /** Fill de `order` usando exclusivamente `candle` (la vela posterior a la decisión). null → sin relleno. */
  evaluate(order: Order, candle: Candle): Fill | null
}

interface Broker {
  submitOrder(order: Order): Order
  cancelOrder(orderId: string): void
  advance(candle: Candle): Fill[] // evalúa órdenes pendientes con esta vela
  positions(): readonly Position[]
}
```

**Invariante anti look-ahead (clave):** dentro de `onCandle`, primero `broker.advance(candle)`
(rellena órdenes enviadas en velas anteriores) y después `strategy.evaluate(...)`. Así una orden
decidida al cierre de la vela N solo puede rellenar en N+1 o después.

## Tareas (TDD: firma + tests en rojo → implementación → verde)

### T1 — Órdenes

- **Archivos:** `src/domain/execution/order.ts` ↔ `test/domain/execution/order.test.ts`
- `OrderSide { Buy, Sell }`, `OrderType { Market, Limit }`, `OrderStatus { Pending, Filled, Cancelled, Rejected }`.
- `Order`: `id`, `side`, `type`, `qty` (finito > 0), `price` (obligatoria y > 0 en `Limit`;
  prohibida en `Market`), `status`, `createdAt` (ms), `rejectReason`.
- Transiciones por métodos (`fill()`, `cancel()`, `reject()`) solo desde `Pending`; cualquier otra
  → `InvalidOrderError extends DomainError`.
- **Aceptación:** validación completa en construcción; imposible rellenar/cancelar dos veces.

### T2 — Fill y modelo de ejecución

- **Archivos:** `src/domain/execution/fill.ts` y `src/domain/execution/executionModel.ts` ↔ tests espejo.
- `Fill { orderId, price, qty, fee, time }`.
- `NextOpenExecutionModel({ slippageBps, feeBps })`:
  - Market Buy → `open * (1 + slippage)`; Market Sell → `open * (1 - slippage)`. Siempre rellena.
  - Limit Buy → fill a `limit` si `open <= limit` o si `low <= limit` (toccada); Market Sell
    simétrico con `high >= limit`; si no se toca → `null`.
  - `fee = price * qty * feeBps / 10_000`.
- **Aceptación:** nunca mira más allá de la vela recibida; resultados deterministas; sin look-ahead
  (el contrato lo impide por tipo: solo recibe una vela).

### T3 — Position (long-only)

- **Archivos:** `src/domain/execution/position.ts` ↔ `test/domain/execution/position.test.ts`
- Estado: `qty`, `avgEntryPrice`, `realizedPnl`, `feesPaid`, `openedAt`.
- `applyFill(fill)`: Buy → media ponderada de entrada; Sell → `realizedPnl += (price - avgEntry) *
qtySold - fee` y reduce `qty` (vender más de lo abierto → error).
- Consultas: `unrealizedPnl(price)`, `marketValue(price)`, `isOpen`, `isEmpty`.
- **Aceptación:** cierre parcial y total, fees incluidas en el P&L realizado, posición vacía a `null`
  o `qty = 0` (decidir en la tarea y mantenerlo en Broker/Portfolio).

### T4 — Portfolio

- **Archivos:** `src/domain/portfolio/portfolio.ts` ↔ `test/domain/portfolio/portfolio.test.ts`
- `initialCapital`, `cash`, una posición (long-only, un instrumento por ahora — simplificación
  explícita), `equity(price)`, `exposure(price)`, acumulados `realizedPnl`/`feesPaid`.
- `applyFill`: buy descuenta `price * qty + fee`; sell acredita.
- **Aceptación:** invariante `cash >= 0` (el broker rechaza antes de romperlo); `equity` coherente
  con `cash + marketValue` sin fees dobles.

### T5 — RiskManager (§8)

- **Archivos:** `src/domain/portfolio/riskManager.ts` ↔ `test/domain/portfolio/riskManager.test.ts`
- Config: `maxPositionFraction` (0,1], `minCashReserve` [0,1), opcional `maxExposureFraction`.
- Responsabilidades: decidir el **tamaño** de entrada (`entryQty` sobre `equity` y precio actual) y
  **aprobar/rechazar** Add (nunca superar capital disponible ni el máximo de exposición). Reduce/Exit
  nunca se bloquean (regla ya establecida en Fase 2: "invalidar nunca impide cerrar").
- **Aceptación:** con capital y precio dados, el qty es determinista y no supera los límites; caso
  de señales concurrentes cubierto (§8: dos señales de compra no pueden duplicar la exposición).

### T6 — Broker

- **Archivos:** `src/domain/execution/broker.ts`, `src/domain/execution/historicalBroker.ts` ↔
  `test/domain/execution/historicalBroker.test.ts`
- `HistoricalBroker({ executionModel, portfolio, risk })`: mantiene órdenes pendientes;
  `advance(candle)` las evalúa con el modelo, aplica los fills a `Position` y `Portfolio` y los
  devuelve; `cancelOrder` pasa a `Cancelled`.
- Rechazo por capital insuficiente → `OrderStatus.Rejected` (controlado, no excepción); qty/precio
  inválidos → `InvalidOrderError` (excepción).
- Ids incrementales deterministas (sin aleatoriedad) para tests reproducibles.
- **Aceptación:** ciclo `submit → advance → Filled/Rejected → positions()`; cancelación efectiva
  antes del relleno; `onFill` de la instancia lo orquesta el runner (T7), no el broker.

### T7 — StrategyRunner (integración)

- **Archivos:** `src/domain/trading/strategyRunner.ts` ↔ `test/domain/trading/strategyRunner.test.ts`
- Ciclo por vela (`onCandle(candles visibles)`):
  1. `broker.advance(vela)` → fills → `instance.onFill()` + `portfolio` ya actualizado por el broker.
  2. `strategy.buildContext` → `evaluate(context, instance.open)` → `instance.apply(decision)`.
  3. Mapeo decisión → orden: `Enter` → Buy (`decision.price` no nulo → Limit, nulo → Market);
     `Add` → Buy con `risk` y fracción; `Reduce` → Sell `fraction * position.qty`; `Exit` → Sell
     total; `Cancel` → `broker.cancelOrder`.
- Devuelve `ExecutionEvent[]`: `StrategyEvent` existentes + `OrderSubmitted`, `OrderFilled`,
  `OrderRejected`, `OrderCancelled` (la máquina de estados **no** cambia; §12D sigue resuelto con
  eventos devueltos, el despacho queda fuera de alcance).
- Sin dependencias de React ni de backtest/replay (§14): recibe velas y devuelve eventos.
- **Aceptación:** ciclo completo — señal → orden → relleno en la vela **siguiente** → posición →
  Add/Reduce → Exit → cierre, con eventos y P&L correctos.

### T8 — Integración E2E y cierre de fase

- **Archivos:** `test/domain/trading/runnerIntegration.test.ts` (o similar) + actualización de
  `docs/proyectstate.md`.
- Escenario extremo a extremo con una estrategia real de Fase 2 (cruce de medias): entradas, adds,
  reduces, salida, veto de invalidación con orden pendiente, comisiones acumuladas y cash final.
- Verificación explícita de no look-ahead: orden decidida en la vela N rellena como pronto en N+1.
- **Aceptación (gate de fase):** `pnpm test && pnpm typecheck && pnpm format:check` en verde y
  `proyectstate.md` actualizado (Fase 3 completa, contadores de tests).

## Orden y dependencias

```
T1 órdenes ─→ T2 execution model ─→ T3 position ─→ T4 portfolio ─→ T5 risk ─→ T6 broker ─→ T7 runner ─→ T8 E2E
```

Cada tarea es una ronda TDD independiente y un commit; no empezar la siguiente con el gate en rojo.

## Fuera de alcance (queda para después)

- Shorts, apalancamiento, liquidaciones, funding (§6, versión futura del modelo de ejecución).
- `PaperTradingBroker` (datos en vivo) y `LiveBroker`.
- UI, métricas, `Experiment` y `MarketClock` (Fase 4).
- Persistencia de estrategias/órdenes y despacho de eventos por suscripción (transversales).
- Estados `Profit`/`Loss` en `StrategyInstance` (decisión cerrada: vía `Position`).

## Puntos abiertos — resueltos durante la implementación

1. **Semántica de `fraction` en `Add`**: fracción del **presupuesto disponible** — el mínimo entre la
   holgura de exposición (`maxPositionFraction * equity - exposición`) y el efectivo tras la reserva.
   Resuelto en `RiskManager.addQty` (T7); `Reduce` es fracción de la posición.
2. **Redondeo de `qty`**: `RiskManager` redondea hacia abajo a **12 decimales** (`roundDownQty`), de
   modo que el coste nunca supera el presupuesto por punto flotante. Un exchange real usaría pasos
   mayores (pendiente cuando haya pasos de precisión).
3. **Posición a `null` vs `qty = 0`**: `Portfolio.position` devuelve **`null`** sin posición o tras
   el cierre; dentro de `Position`, `qty = 0` (`isEmpty`) marca la posición agotada (la siguiente
   entrada crea otra).

### Ajustes surgidos en T8 (documentados)

- **`RiskManager.slippageBps`**: el sizing solo con fee no bastaba — con `maxPositionFraction: 1` y
  slippage, el coste real de la orden market superaba el cash y la entrada se rechazaba. El coste
  unitario estimado es ahora multiplicativo: `price * (1 + slippageBps/1e4) * (1 + feeBps/1e4)`,
  coherente con `NextOpenExecutionModel`.
- **`StrategyInstance` no se tocó**: los rechazos del broker no añaden estados; el ciclo se
  recupera reenviando la orden con la señal viva (refresh desde el mismo estado).
