# Plan: editor de estrategias + experimentos por estrategia + test-forward interactivo

> Fuentes: `AGENTS.md` (§4, §7C), `docs/proyectstate.md`, exploración del código.
>
> Decisiones del usuario (2026-11):

1. **Editor de plantilla** (no editor libre de reglas anidadas arbitrarias por el usuario… ver 12).
2. **El test-forward interactivo sustituye por completo** al split dev/eval con deltas.
3. **Aleatoriedad libre** (`Math.random`), sin semilla reproducible.
4. **El usuario también decide las salidas** por señal durante la simulación.
5. **TP/SL = reglas de salida** evaluadas por el runner al tocar el precio (sin órdenes
   condicionales en el broker).
6. **Triggers** = lista libre de {precio, acción del broker}, con ejecución **limit o market
   definida por la estrategia** (no por el usuario en runtime).
7. **Test-forward**: el usuario puede **modificar o desactivar el TP/SL durante la simulación**
   (override manual + revertir a auto).
8. **Catálogo de indicadores** = actual (SMA, EMA, RSI) + **indicador constante** (ver 1.3);
   no se amplía con MACD/ATR/Bollinger en este plan.

### Correcciones sobre el modelo de estrategia (última revisión)

9. **Una estrategia no contiene precios absolutos**: todo precio (entrada, TP, SL, triggers) se
   calcula **siempre con indicadores y relaciones entre ellos**. Cero números constantes como
   operandos: donde antes iría `2 * atr14` va un **indicador constante** declarado
   (`two * atr14`, p. ej. `rsi30()` = indicador que devuelve 30). Un umbral `rsi > 30` se
   expresa como serie `rsi > umbral30` donde `umbral30` es un indicador constante.
10. **Alias de operación**: además de indicadores, las expresiones/reglas pueden referenciar
    `entry` (precio de relleno de la posición), `sl` y `tp` (niveles efectivos actuales,
    incluido el override manual de la sesión).
11. **Una regla puede estar formada por varias condiciones**: árbol arbitrario de
    AND/OR/NOT (como `All/Any/Not` que ya existe en el dominio).
12. **Clasificación de indicadores y compatibilidad POR CONDICIÓN**: oscilador (rango fijo,
    p. ej. RSI) vs indicador sobre precio (SMA/EMA, sin rango fijo) vs constante. Un
    oscilador **sí puede** formar parte de una condición —
    `(close() > ema(12)) and (rsi(14) < rsi30())` — pero **nunca se comparan** un indicador
    de precio con un oscilador **en la misma condición**. Cada condición binaria compara
    operandos de la misma clase; los constantes son compatibles con cualquier clase.

### Enmienda F — editor de estrategias (huecos resueltos, 2026-11)

13. **Versionado al editar**: editar crea una **versión nueva** (`version = max(las del mismo
name) + 1`) y **conserva la anterior**; el formulario **no pide versión** (la asigna la UI
    antes de `save`). Invariante en `StrategyRepository`: `name@version` → **contenido único**
    (misma clave si el contenido coincide; error si ya existe otro contenido con ese
    `name@version`). Lista y selector muestran todas las versiones; se borran desde el panel.
14. **Reproducibilidad**: sin cambios en `Experiment` (decisión de alcance de §1.9). Se confía
    en el invariante 13 (`name@version` identifica un contenido) + `fingerprint` para detectar
    manipulación; si se borra la versión, el experiment queda como registro histórico y el
    comparador del Historial avisa (`history-differences`).
15. **UI de `PriceExpr`**: **suma de productos** (forma plana): fila de términos con signo
    `+`/`-`; cada término = producto de series. Cubre `sma_fast + two * atr14`; sin paréntesis.
    El dominio sigue aceptando el árbol completo; si se carga una spec fuera de esa forma
    (solo posible si se creó fuera de la UI) → aviso "expresión no editable en el formulario".
16. **Detalles del formulario**:
    - "Nueva" parte de una **plantilla sma-cross prefilled** (no vacío).
    - TP/SL invertido: **solo avisa** al guardar (no bloquea), como indican los riesgos.
    - `StrategyPanel` = **CRUD puro**; el selector único sigue en la sección Experimentos
      (enmienda §1.9). No se duplica la selección.
    - **Borrado libre** aunque haya experimentos (los snapshots son independientes).
    - `fraction` de los triggers: campo **solo para `request_add`/`request_reduce`**,
      fracción `(0, 1]` con paso 0.01; oculto para `entry`/`exit`.
    - API para el editor (evita duplicar la clasificación): exportar de `spec.ts`
      **`seriesClasses(spec)`** (builtins + `entry`/`sl`/`tp` + indicadores de la spec) y
      **`operationAliases(contexto)`** (disponibilidad de `entry`/`sl`/`tp` por contexto:
      `entry.rule`/`invalidation` → ninguno; `exitRule`/triggers → los tres;
      `takeProfit`/`stopLoss` → solo `entry`).

## Estado actual (punto de partida)

- No hay creador ni persistencia de estrategias: la demo `sma-cross` está **duplicada en 5
  sitios** (`BacktestPanel`, `TestForwardPanel`, `ReplayPanel`, `OptimizationPanel` y tests E2E).
- `ExperimentRepository` (localStorage) ya hace CRUD de experimentos; cada snapshot guarda
  `strategyId = "name@version"` + `fingerprint`, pero **la definición no está almacenada**.
- `runTestForward` (`src/domain/backtest/testForward.ts`) parte velas por `cutTime` y lanza
  **dos backtests automáticos**. Es literalmente un backtest.
- **No existe TP/SL en ningún sitio** (ni `Position`, ni `RiskManager`, ni broker). `Order` solo
  admite `Market` | `Limit` (long-only); `Signal` ya tiene `limitPrice?: SeriesRef` (hoy
  `SeriesRef = string | number`, con números — el nuevo spec lo restringe a `string`).
- Reglas anidadas **ya existen** en el dominio: `All`/`Any`/`Not` (`rules.ts`); `MarketContext`
  ya resuelve series por alias. Lo que falta es serializarlas y construirlas desde spec.
- Motor vela a vela compartido: `TradingSession.advance()` y `MarketReplayEngine` (step/reset).
  **No hay mecanismo de salto/seek** (a crear).
- El gráfico se recorta con `replayCursor` en `App.tsx`: patrón a reutilizar (`tfCursor`).

---

## Cambio 1 — Modelo de estrategia: expresiones, reglas compuestas, TP/SL y triggers

### 1.1 `PriceExpr` — expresiones de precio sin constantes (nuevo `src/domain/strategies/priceExpr.ts`)

```ts
/** Solo series (alias de indicador o alias de operación) y sus relaciones. Sin números. */
type PriceExpr =
  | { kind: 'series'; id: string }                                 // alias de indicador | 'entry' | 'sl' | 'tp'
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: PriceExpr; right: PriceExpr }

evaluatePriceExpr(expr: PriceExpr, context: MarketContext): number | null
// null si: serie en calentamiento, alias no registrado (propaga MarketContextError),
//          división por cero o resultado no finito.
```

- Validación (`assertPriceExpr`): sin literales numéricos (el tipo ya los excluye);
  `entry`/`sl`/`tp` **solo** donde tienen sentido:
  - `entry`: en `takeProfit`/`stopLoss` y en triggers/exitRule (no en la definición de
    `entry.price` — aún no hay posición).
  - `sl`/`tp`: en triggers y exitRule (no dentro de su propia definición — evita
    auto-referencia circular; `sl` puede referenciar `tp` y viceversa solo si se define sin
    auto-referencia → regla simple: los alias `sl`/`tp` no están disponibles dentro de las
    expresiones `takeProfit`/`stopLoss`).
- Alias de operación resueltos en `MarketContext` (ver 1.4): `entry` =
  `position.avgEntryPrice`, `sl`/`tp` = nivel efectivo (override ?? expresión de la estrategia).
- Builders en código/tests: `series('sma_fast')`, `plus(a, b)`, `minus`, `times`, `dividedBy`.

### 1.2 `RuleSpec` — regla como árbol de condiciones (nuevo `src/domain/strategies/spec.ts`)

```ts
/** Operando de condición: alias de indicador, serie builtin o alias de operación. Sin números. */
type SeriesAlias = string   // p. ej. 'sma_fast', 'rsi14', 'umbral30', 'close', 'entry'

type RuleSpec =
  | { kind: 'condition'; op: 'crosses_above' | 'crosses_below' | '>' | '<'; a: SeriesAlias; b: SeriesAlias }
  | { kind: 'and'; rules: RuleSpec[] }        // ≥ 1 hijo
  | { kind: 'or';  rules: RuleSpec[] }        // ≥ 1 hijo
  | { kind: 'not'; rule: RuleSpec }

buildRule(spec: RuleSpec): Rule               // → CrossesAbove/Below, Greater/Lower, All, Any, Not
```

- Árbol arbitrario (decisión 11), reflejo directo de los `Logical` existentes.
- **Series builtin de la vela actual** como operandos: `close`, `open`, `high`, `low`
  (clase `price`) — es la forma de escribir `close() > ema(12)`; se resuelven en
  `MarketContext` (ya tiene `current`/`previous`), sin crear indicador.
- `rsi > 30` deja de existir en el spec: se declara el indicador constante `umbral30` y la
  condición es `rsi > umbral30` (decisión 9).
- **Validación de clase por condición** (decisión 12): en cada nodo `condition`, ambos
  operandos deben ser de la misma clase (`price`↔`price`, `oscillator`↔`oscillator`); la
  clase `constant` es compatible con cualquier otra. `close > rsi14` →
  `InvalidStrategyDefinitionError`. La validación es recursiva por todo el árbol.
- Alias desconocido → `InvalidStrategyDefinitionError` al construir (validación cruzada
  contra `indicators` + alias de operación permitidos en ese contexto).

### 1.3 Catálogo de indicadores + clasificación

```ts
type IndicatorSpec =
  | { alias: string; kind: 'sma' | 'ema' | 'rsi'; period: number } // period: entero ≥ 1 (parámetro, no precio)
  | { alias: string; kind: 'const'; value: number } // serie constante, p. ej. rsi30()
```

- `const`: indicador que devuelve un número fijo en todas las velas (el "siempre oscila entre
  un rango / umbral" del usuario). Es la **única** vía para inyectar un número en una regla o
  expresión.
- Clasificación (decisión 12): `oscillator` (RSI, rango fijo), `price` (SMA/EMA, `close`/`open`/
  `high`/`low`, sin rango), `constant`. El editor agrupa el selector de operandos por clase y
  **valida por condición**: misma clase a ambos lados (constante compatible con cualquiera).
  En **expresiones de precio** (`entry.price`, TP, SL, triggers) solo admiten series de clase
  `price`/`constant` y alias de operación (`entry`/`sl`/`tp`): una expresión de precio con
  oscilador no es un precio (`rsi + sma` → error de spec).

### 1.4 `StrategySpec` — especificación serializable

```ts
interface StrategySpec {
  name: string
  version: number
  indicators: IndicatorSpec[]
  /** `limit` exige `price`; `market` lo prohíbe (la orden va a mercado sin precio). */
  entry:
    | { rule: RuleSpec; price: PriceExpr; execution: 'limit' }
    | { rule: RuleSpec; execution: 'market' }
  takeProfit?: { price: PriceExpr; execution: 'limit' | 'market' } // sin alias sl/tp dentro
  stopLoss?: { price: PriceExpr; execution: 'limit' | 'market' } // sin alias sl/tp dentro
  triggers?: {
    price: PriceExpr
    action: TriggerAction
    execution: 'limit' | 'market'
    fraction?: number // solo en add/reduce (como en Signal)
  }[]
  exitRule?: RuleSpec // salida por regla; en test-forward la decide el usuario
  invalidation?: RuleSpec // veto → Invalidate
}

type TriggerAction = 'request_entry' | 'request_add' | 'request_reduce' | 'request_exit'
```

- **`buildStrategy(spec): Strategy`** — pura, spec → `Strategy` (dominio existente ampliado);
  valida la semántica (alias registrados, clases, alias de operación por contexto) y ensambla
  indicadores, señales (`entry.rule` → `RequestEntry` con price solo si limit; `exitRule` →
  `RequestExit` market), niveles TP/SL, triggers y veto. Lanza `InvalidStrategyDefinitionError`.
- **`parseStrategySpec(value): StrategySpec`** — validación de **forma** para persistencia
  (`assertStrategySpec`): tipos, rangos, reglas limit⇔price, aliases no reservados/únicos,
  reglas de fraction. Lanza errores de dominio (`InvalidStrategyDefinitionError`; un price
  malformado propaga `InvalidPriceExprError`) y **el repositorio envuelve en
  `CorruptedStorageError`** (mismo patrón que `Trade.from` → `ExperimentRepository`).
- `strategyFingerprint`/`canonicalHash` existentes → id de la clave de storage.

### 1.5 Evaluación en `Strategy` (ampliación, mismo contrato `evaluate`)

`StrategyDefinition` gana `takeProfit`/`stopLoss`/`triggers` (opcional); `signals` sigue siendo
el mecanismo interno (`entry.rule` → señal `RequestEntry` con `price` si execution es `limit`;
`exitRule` → señal `RequestExit` a mercado — la spec lo convierte, no es campo de
`StrategyDefinition`). Prioridad **tras el veto**:

1. **SL** (abierta, `low <= sl`) → `RequestExit @ sl` (primero que TP: conservador).
2. **TP** (abierta, `high >= tp`) → `RequestExit @ tp`.
3. **Reglas** (`entry.rule` con posición cerrada; `exitRule` con abierta).
4. **Triggers** por toque direccional con `isApplicable`:
   venta (exit/reduce) → `high >= price`; compra (entry/add) → `low <= price`.

- **Invariante `price` ⇔ limit**: la decisión lleva `price` resuelto solo si la ejecución es
  `limit`; a `market` la decisión va sin precio. `createOrder` del runner **no cambia**
  (`price === null ? Market : Limit`) y el sizing de órdenes market sigue usando el cierre.
  Los niveles efectivos (`entry`/`sl`/`tp`) se materializan en el contexto antes de evaluar,
  para que reglas y triggers los vean vía `value('sl')`.
- Sin datos (calentamiento), sin posición o alias de operación sin valor → `null` → no evalúa
  ese ciclo. Los overrides de sesión (`sl`/`tp`) solo se aplican si la estrategia declara el
  nivel correspondiente.

### 1.6 `MarketContext` — alias de operación

`MarketContext.from` acepta `levels?: { entry?: number | null; sl?: number | null; tp?: number | null }`,
`value('entry' | 'sl' | 'tp')` los resuelve (alias de operación sin histórico: `back > 0` → `null`)
y `withLevels(...)` deriva un contexto que **comparte velas e indicadores** (barato). El
**runner inyecta `entry` tras los rellenos** (antes de `evaluate`) para que SL/TP/`entry` vean el
precio real desde la misma vela en que se abre la posición; los overrides `sl`/`tp` de la sesión
se inyectan igual. El contexto sigue siendo puro (recibe valores, no conoce el broker).

### 1.7 Persistencia: `StrategyRepository` (nuevo `src/storage/strategyRepository.ts`)

Clon de `ExperimentRepository`: `Storage` inyectado, claves `strategies:<id>` (id = hash del
spec), `save/find/list/remove/clear`, corrupto → `CorruptedStorageError`. **Semilla**: si está
vacío se guarda la demo `sma-cross` como spec (con sus indicadores y reglas compuestas).
**Invariante (enmienda 13)**: `name@version` → contenido único — `save` con un contenido ya
existente es idempotente (misma clave), pero si `name@version` corresponde a **otro** contenido
distinto lanza `InvalidStrategyDefinitionError` (evita etiquetas ambiguas en el selector). La UI
asigna la versión con **`nextVersion(name)`** (max + 1, 1 si no existe).

### 1.8 UI: editor + selector

- **`StrategyPanel.tsx`** — tercera sección del sidebar (`SidebarSection` id `estrategias`):
  lista (nombre@versión + fingerprint) con Nueva / Editar / Borrar. **CRUD puro** (enmienda 16):
  el selector único de ejecución sigue en la sección Experimentos (§1.9). Editar asigna
  `version = max + 1` y conserva la anterior (enmienda 13); "Nueva" parte de la plantilla
  sma-cross prefilled (enmienda 16).
- **`StrategyEditor.tsx`** — formulario por bloques:
  - Indicadores: filas alias + tipo (SMA/EMA/RSI/constante) + parámetro; agrupados por clase
    (oscilador / precio / constante). Clases vía `seriesClasses(spec)` (enmienda 16).
  - **Editor de reglas anidadas**: árbol visual con add-condición / add-grupo (AND/OR) /
    NOT por nodo / quitar; operandos = selector de alias (indicadores + series builtin
    `close`/`open`/`high`/`low` + `entry`/`sl`/`tp` vía `operationAliases(contexto)`, enmienda 16) **filtrado por clase de la condición**: al elegir el primer operando, el segundo solo
    ofrece aliados compatibles (misma clase o constante). Profundidad libre pero con deshacer
    sencillo.
  - Entrada: regla (árbol) + expresión de precio en **suma de productos** (enmienda 15): fila
    de términos con signo, cada término = producto de series, sin campos numéricos salvo el
    parámetro de los indicadores + limit/market.
  - TP / SL: expresión (alias `entry` disponible) + limit/market + activo. Nivel invertido →
    aviso al guardar, no bloquea (enmienda 16).
  - Triggers: filas {expresión, acción, ejecución, **fraction solo en add/reduce (0, 1]**}
    (enmienda 16; el dominio la exige en esas acciones).
  - Salida por regla y veto opcionales.
  - Guardar → `parseStrategySpec`/`buildStrategy` validan; errores de dominio en el formulario.
- `App.tsx` + `main.tsx`: `StrategyRepository` como prop (composition root).

### 1.9 Experimentos múltiples, cada uno con su estrategia

- Los 4 paneles dejan de construir `sma-cross` hardcoded y reciben **`strategies: StrategySpec[]`
  - selector**; cada ejecución usa `buildStrategy(spec)` → el snapshot registra
    `strategyId`/`fingerprint` reales → el Historial compara experimentos de estrategias
    distintas (**sin cambios en `Experiment`**).
- `OptimizationPanel`: la fábrica deriva de la spec elegida; el grid varía los **periodos** de
  los indicadores sobre su estructura; specs sin indicadores con parámetro → aviso, no ejecuta.

---

## Cambio 2 — Test-forward interactivo (sustituye al split dev/eval)

### 2.1 Semántica (§7C reinterpretado)

1. **Puntos de confirmación** = velas donde `entry.rule` dispara (posición cerrada). La regla
   **es** la confirmación; el precio de entrada (limit o market, según la spec) se envía si el
   usuario acepta.
2. El sistema **elige al azar** (`Math.random`) un punto pendiente posterior al cursor y pausa:
   el gráfico muestra las velas **solo hasta ese instante**.
3. El usuario decide: **tomar / descartar** (entrada) · **cerrar / mantener** (salida por
   `exitRule`).
4. Tras decidir: **avanzar vela a vela** (`step`; confirmación → pausa) o **saltar al siguiente
   punto aleatorio** (entre los puntos futuros, no el cronológico siguiente).
5. **TP/SL y triggers se ejecutan solos** (compromisos de precio de la estrategia), salvo que
   el usuario **modifique o desactive el TP/SL** en la sesión: override a precio absoluto
   manual, revertir a auto, desactivar por nivel. (Los overrides viven en la sesión; la
   `Strategy` permanece pura. Los alias `sl`/`tp` de las expresiones resuelven el **efectivo**.)
6. `finished` cuando no quedan puntos futuros ni velas.

Anti look-ahead: decisión en vela N → relleno en N+1; solo se ve hasta el cursor.

### 2.2 Dominio: `src/domain/testforward/` (nuevo módulo)

- **`confirmationPoints(strategy, candles): number[]`** — barrido puro estadoless (contexto por
  prefijo, `entry.rule` + veto) → índices confirmados.
- **`TestForwardSession`** — envuelve `TradingSession` + `RecordingBroker` (motor compartido):
  - Estado: `cursor`, posición, `tpOverride/slOverride/tpEnabled/slEnabled`, `log` de
    decisiones, `status: 'idle' | 'awaiting' | 'finished'`.
  - `start(random = Math.random)`, `decide(take)`, `step()`, `jump()`, `reset()`.
  - `step()`/`jump()` procesan vela a vela (TP/SL/triggers auto con nivel efectivo) y pausan
    ante nuevas confirmaciones de `entry.rule`.
  - `setTakeProfit(price | null, enabled)`, `setStopLoss(...)`.
  - `jump()`: avance en bucle de `advance()` hasta un índice futuro al azar (stack coherente:
    fills N+1, equity, log); sin candidatos → `finished`.
  - **Testabilidad**: `random: () => number` inyectable (default `Math.random`).
- `TestForwardError` (`DomainError` con `this.name`).

### 2.3 Eliminar el test-forward automático

- Borrar `src/domain/backtest/testForward.ts`, `src/domain/backtest/split.ts` (solo lo
  consumía `testForward` + tests, verificado con grep) y `test/domain/backtest/split.test.ts`.
- Borrar `src/components/TestForwardResults.tsx`.
- Reescribir `TestForwardPanel.tsx`: selector de estrategia + capital/fee/slippage + **Iniciar
  sesión**.
- Nueva UI de sesión (pestaña Test-Forward, patrón Replay montada en `hidden`): **Tomar/
  Descartar** (o Cerrar/Mantener), **Paso**, **Saltar (aleatorio)**, **Reiniciar**, controles
  TP/SL (valor efectivo, override, revertir, activar/desactivar), progreso, equity, posición,
  log. Gráfico en la pestaña con `tfCursor` en `App` (`visible = candles.slice(0, tfCursor)`).
- `TestForwardRun`/`lastTestForward` desaparecen de `App`.

### 2.4 Tests

- Borrar/adaptar: `testForward.test.ts`, `split.test.ts`, `laboratorioE2E.test.ts` (partes
  split/deltas), `TestForwardResults.test.tsx`; `strategy.test.ts`/`strategyRunner.test.ts`/
  `fingerprint.test.ts`/`rules.test.ts` adaptados al nuevo spec (`SeriesRef` sin números en el
  spec, reglas compuestas, prioridades de `evaluate`).
- Nuevos: `priceExpr.test.ts`, `spec.test.ts` (incl. reglas anidadas, alias de operación,
  constantes, validaciones), `strategyRepository.test.ts`,
  `confirmationPoints.test.ts`, `session.test.ts` (RNG inyectado, tomar/descartar, pausa,
  TP/SL auto + overrides, salida por regla con decisión, anti look-ahead, `reset` §12C,
  finish sin candidatos), `StrategyPanel/StrategyEditor`, `TestForwardPanel` reescrito,
  `App.test.tsx` ampliado.

### 2.5 Notas de implementación (Ronda G — decisiones tomadas)

- **`start()` ≡ `jump()`**: el RNG se inyecta en el **constructor**
  (`random: () => number = Math.random`); `start` es el alias de arranque y comparte la
  semántica de salto (plan: `start(random)` — la inyección por constructor sirve a todos los
  saltos de la sesión y a los tests).
- **Codificación de los overrides**: `setTakeProfit(price, enabled)` con
  `enabled=false` → desactivado; `price=null` + `enabled=true` → **automático** (revertir);
  `enabled=true` + número → override manual. Solo surte efecto si la estrategia declara el
  nivel (§1.5). Igual para `setStopLoss`.
- **Semántica de `jump`**: el destino es un punto futuro al azar; las **entradas intermedias
  se descartan** (el destino manda, §2.1.4) pero las **salidas por regla interrumpen** cualquier
  avance (`step`, `jump` y la corrida final sin candidatos): dejar pasar una salida dejaría la
  posición sin su regla de cierre. Sin candidatos → procesa el resto de velas y `finished`.
- **Órdenes aceptadas**: `decide(true)` replica el envío del runner (mismo sizing de
  `RiskManager`, `price ⇔ limit`, relleno en N+1) pero la orden es de la sesión (`t<n>`); el
  relleno se notifica al broker-decorador **durante** el paso 3 del runner para que la instancia
  transicione antes de evaluar la vela del relleno (sin hueco en SL/TP/exitRule). Un veto
  posterior **retira** la orden de entrada aceptada (misma semántica que el runner).
- **Identificación de la fuente** de una decisión (`signal` vs `trigger`/nivel): por
  `reason === signal.name` — los triggers usan `"acción @ expresión"` y los niveles
  `stop_loss`/`take_profit`, sin colisión con `"acción: regla"`; la prioridad la sigue
  decidiendo `Strategy.evaluate` sin replicarla.

---

## Orden de implementación (TDD por rondas)

| #   | Ronda                                                                                                                                                          | Resultado                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A   | `PriceExpr` (sin constantes, alias de operación) + `evaluatePriceExpr` + builders + tests                                                                      | Expresiones de precio puras                        |
| B   | `RuleSpec` árbol + `buildRule` + indicador `const` + series builtin + validación de clase por condición + tests                                                | Reglas compuestas serializables                    |
| C   | `StrategySpec` completo + `buildStrategy` + `parseStrategySpec` + `MarketContext.levels` + ampliación de `Strategy.evaluate` (TP/SL/triggers/exitRule) + tests | Dominio de estrategia completo                     |
| D   | `StrategyRepository` + semilla + tests                                                                                                                         | CRUD persistido                                    |
| E   | Selector de estrategia en Backtest/Replay/Optimization                                                                                                         | Experimentos con estrategias distintas             |
| F   | `StrategyPanel` + `StrategyEditor` (árbol de reglas) + sidebar + `App`/`main.tsx`                                                                              | Crear/editar/borrar desde la UI                    |
| G   | Dominio `confirmationPoints` + `TestForwardSession`                                                                                                            | Motor del nuevo test-forward                       |
| H   | UI de sesión + `tfCursor` + borrado del split dev/eval                                                                                                         | Sustitución completa                               |
| I   | Limpieza, `docs/proyectstate.md`, checks                                                                                                                       | `pnpm test && pnpm typecheck && pnpm format:check` |

## Riesgos / notas

- **Semántica TP/SL por vela** (reglas de salida, no bracket orders): toque con `high`/`low` de
  la vela N → fill en N+1 (peor precio que un TP real intrabar; aceptado, coherente con el
  anti look-ahead). Nivel invertido (TP bajo la entrada) dispararía al instante: lo avisa la
  UI al guardar.
- **Sin números en el spec**: obliga a declarar un indicador constante para cada umbral o
  coeficiente (`two`, `umbral30`). Coherente con "solo indicadores y relaciones", pero el
  editor debe hacerlo fácil (atajo "añadir constante" junto al selector de operandos).
- **Clase del operando**: en condiciones → misma clase a ambos lados (`price`↔`price`,
  `oscillator`↔`oscillator`, `constant` con cualquiera); en expresiones de precio → solo
  `price`/`constant`/alias de operación (osciladores excluidos). Validación en `buildStrategy`
  y feedback en el editor (selector de operandos filtrado por clase).
- **Auto-referencia** `sl`/`tp`: prohibida dentro de su propia expresión (validación en
  `buildStrategy`).
- **`entry` incluye fees** (`Position.avgEntryPrice`): desviación mínima; documentado.
- **Prioridad SL > TP > reglas > triggers** en una misma vela (una orden en vuelo ya lo
  resuelve; el orden fija qué decisión gana).
- **Rendimiento de `confirmationPoints`** O(n²) con contexto por prefijo; con
  `MAX_CANDLES = 1000` aceptable (follow-up: cálculo incremental).
- **Sin retroceso temporal**: `jump()` solo elige puntos futuros (`MarketClock` estricto).
- **La sesión no genera `ExperimentSnapshot`** (decisiones humanas + `Math.random`); su
  resultado es el log + equity en la pestaña (persistirlo exigiría `SessionRecord`, fuera de
  este plan).
- **Optimización**: grid sobre los periodos de la spec; specs sin parámetros → aviso.
