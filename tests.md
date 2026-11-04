# Plan de tests — TDD

Regla transversal: **toda decisión solo usa datos con `time <= tiempoActual`** (anti-lookahead).
Se valida con tests de propiedades (fast-check) sobre el motor de backtest.

Capas:

- `src/domain/**` — lógica pura, TDD normal (el grueso del trabajo). Solo implementación, sin tests.
- `test/domain/**` — tests espejo de `src/domain` (mismas carpetas, imports vía alias `@/domain/...`).
- `src/storage/**` — repositorios con `localStorage`/`Storage` inyectado y mockeado.
- `src/components/**` + `test/components/**` — Testing Library (semiestados: loading/error/vacío).
- E2E — solo humo con API mockeada (MSW), no forma parte del TDD.

---

## #1 — Gráfico de velas + timeframe ✅ en progreso

- [x] `Timeframe.from` parsea `1m,5m,15m,1h,4h,1d` e internea instancias; lanza `InvalidTimeframeError` ante desconocidos.
- [x] `Timeframe.is` / `Timeframe.isCode` distinguen instancia de código crudo sin lanzar.
- [x] `Timeframe` expone `ms` (duración) y serializa a código (`toString`/`toJSON`, round-trip JSON).
- [x] `candleLimitForRange` calcula el limit del rango, sanea fechas invertidas y limita a `MAX_CANDLES`.
- [x] `Candle` (value object): `from` parsea y valida invariantes (campos finitos, `high >= low`, idempotente); `toJSON` + `from` round-trip.
- [x] Comportamiento de la vela: `isBullish`/`isBearish` (doji → ninguno), `bodySize`, `range`, `equals` por valor.
- [x] `Candle.aggregate` fusiona un grupo: open primero, close último, extremos, volumen sumado, `time` al inicio del bucket, sin mutar entradas, grupo vacío rechazado.
- [x] `normalizeCandles` convierte OHLC a números (acepta strings de API).
- [x] `normalizeCandles` ordena ascendente por tiempo (entrada descendente).
- [x] `normalizeCandles` elimina duplicados manteniendo el último.
- [x] `normalizeCandles` descarta velas inválidas (`high < low`, precios no finitos, campos ausentes).
- [x] `normalizeCandles` lanza ante entrada que no es un array.
- [x] `aggregateCandles` agrega 1m → mayor timeframe (recibe `Timeframe`; open primero, close último, high máx, low mín, volumen suma) y rechaza valores que no son `Timeframe`.
- [x] `aggregateCandles` con input desordenado agrega correctamente.
- [x] `aggregateCandles` con array vacío → `[]`.
- [ ] Estados de UI: loading / error de red / datos vacíos.
- [ ] Cambio de timeframe dispara refetch y limpia velas anteriores.

## #2 — Estrategia visual

**Indicadores** (fixtures con valores calculados a mano):

- [ ] `SMA` periodo conocido → valores exactos; periodo > nº velas → `null` en el head.
- [ ] `EMA` valores exactos (semilla = primer valor o SMA, documentar convenio).
- [ ] `RSI(14)` → valor esperado; sin pérdidas → 100.
- [ ] `MACD` → línea, señal y histograma con valores esperados.
- [ ] `Bollinger` → bandas; σ = 0 → bandas iguales al medio.
- [ ] `crossesAbove` / `crossesBelow` → cruce real, empate (`A[i] === B[i]`), sin cruce, longitudes distintas.

**Condiciones:**

- [ ] Comparadores `>`, `<`, `>=`, `<=`, `cruza arriba`, `cruza abajo` sobre pares de series.
- [ ] Grupos AND/OR anidados → tabla de verdad.
- [ ] Condición referenciando indicador no definido → error localizado (no crash).

**Validación/serialización:**

- [ ] Guardar sin condición de entrada → rechazado con mensaje.
- [ ] Parámetros inválidos (periodo ≤ 0, RSI > 100) → rechazado.
- [ ] `strategy → JSON → strategy` round-trip idéntico + migración de versión.

## #3 — CRUD de estrategias (persistencia local)

- [ ] `save/list/get/delete` sobre `Storage` inyectado (mock).
- [ ] IDs únicos; `createdAt`/`updatedAt` correctos.
- [ ] `update` de id inexistente → error tipado, nada sobrescrito.
- [ ] JSON corrupto en storage → `[]` sin lanzar.
- [ ] `QuotaExceededError` → error controlado, datos previos intactos.
- [ ] Dos estrategias → aislamiento (guardar una no pisa la otra).

## #4 — Backtest (pieza central)

**Motor:**

- [ ] Señal en vela N → entrada en vela N+1 (test explícito de lookahead).
- [ ] Con posición abierta, señales de entrada ignoradas.
- [ ] Salida por cruce contrario → cierre en vela siguiente.
- [ ] SL y TP tocados en la misma vela → peor caso (SL primero).
- [ ] Slippage + comisión → PnL verificado a mano.
- [ ] Sizing fijo y sizing por % de equity.
- [ ] Sin trades en el rango → `[]`, no lanza.

**Métricas** (fixture de 3–5 trades calculada a mano):

- [ ] Win rate; 0 trades → definición explícita (no `NaN`).
- [ ] Profit factor, expectancy, avg win, avg loss.
- [ ] Max drawdown (pico→valle sobre curva de equity).
- [ ] Sharpe (definir returns y anualización) y Sortino.
- [ ] Net PnL tras comisiones, nº trades, benchmark buy&hold.
- [ ] Borde: todos ganadores, todas pérdidas, racha de pérdidas.

**Propiedades (fast-check):**

- [ ] `equityFinal == inicial + Σ PnL trades − Σ comisiones`.
- [ ] Determinismo: mismas entradas → salida idéntica.
- [ ] Ninguna decisión usa velas futuras.

**Rango:**

- [ ] Sin velas suficientes → error claro; fechas invertidas → saneadas.

## #5 — Trades en gráfico y lista

- [ ] Marcadores de entrada/salida en el índice de vela correcto, con lado (long/short).
- [ ] Tabla: entry/exit, tamaño, PnL, R-múltiplo, duración en velas, razón de salida (señal/SL/TP/fin de rango).
- [ ] Consistencia gráfico ↔ tabla (mismo array, mismos ids).
- [ ] Orden por fecha y por PnL.

## #6 — Resultados de backtests guardados

- [ ] Guardar resultado con **snapshot** de la estrategia (no referencia viva).
- [ ] Editar/borrar la estrategia original → el resultado sigue abiensible con los datos originales.
- [ ] Listar por fecha/estrategia; borrar resultado no borra la estrategia.
- [ ] Storage corrupto → lista vacía + aviso.

## #7 — Paper trading

- [ ] Motor de sesión consume ticks → evalúa condiciones → mismas reglas de ejecución que backtest.
- [ ] **Paridad:** misma estrategia + ticks simulados como velas → mismos trades que el backtest.
- [ ] Estado: posición abierta, PnL realizado y flotante, equity, historial.
- [ ] Una sola posición a la vez; sin reentrada duplicada; size respetado.
- [ ] Cierre manual → PnL liquidado con comisión.
- [ ] Señales evaluadas al cierre de vela del timeframe elegido.
- [ ] Caída del stream → estado de error/reconexión sin perder la sesión.
- [ ] Cierre de sesión → win rate, PnL, nº trades, duración.

---

## Fuera de TDD

- Render exacto del gráfico (canvas/SVG) → smoke test + revisión visual.
- Respuesta real del exchange → fixtures/MSW (el contrato se testea en #1).
- Estilos y disposición.
