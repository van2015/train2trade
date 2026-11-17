# Mutation testing — registro de triage

Ejecutado con Stryker (`pnpm test:mutation`, config en `stryker.config.mjs`).
Este documento registra el **estado, las decisiones de política y el historial del ratchet**;
el detalle vivo está en `reports/mutation/mutation.json` (generado, no versionado).

## Estado baseline (2026-11-16)

| Métrica                            | Valor                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alcance                            | `src/domain/**` (48 ficheros)                                                                                                                                                                                                                                                                                                    |
| Mutantes                           | 4.249 totales → 56 static ignorados (`ignoreStatic`), 1.630 `CompileError` (checker TS, excluidos del score)                                                                                                                                                                                                                     |
| Efectivos                          | 2.707 → 2.128 killed · **518 survived** · 51 noCoverage · 10 timeout                                                                                                                                                                                                                                                             |
| **Mutation score**                 | **78,6 %** (ratchet: `thresholds.break = 73`)                                                                                                                                                                                                                                                                                    |
| Duración                           | 29 min (suite completa); runs acotados con `--mutate 'src/domain/<pkg>/*.ts'` → 1-3 min                                                                                                                                                                                                                                          |
| Cobertura de `src/` (líneas/ramas) | **8.065** — baseline regenerado el 2026-11-16: el `imports:fix` eliminó 1 línea de import en `backtest.ts` y otra en `build.ts`, lo que desplazó sus números de línea e hizo inválida la comparación con el baseline anterior (8.041). Sin ese cambio, la cobertura solo sube (los tests nuevos de los lotes A1-A3 ganan rutas). |

### Configuración con decisiones

- `ignoreStatic: true`: los mutantes estáticos (7 % de los mutantes) suponían ~58 % del tiempo
  (recomendación propia de Stryker). Quedan fuera del score.
- `checkers: ['typescript']`: elimina ~39 % de mutantes (no compilan) — ahorra ejecución.
- `coverageAnalysis: perTest` (lo fuerza el runner de Vitest): por mutante solo corren los
  tests que ejercitan esa línea.
- `appendPlugins`: **necesario con pnpm** — el glob por defecto `@stryker-mutator/*` se resuelve
  sobre las dependencias aisladas de `core` y no ve `vitest-runner`/`typescript-checker`.
- `src/components` queda fuera de alcance a propósito (JSX + mocks: bajo señal, mucho ruido).

## Política de triage

1. **Lote A — `NoCoverage`**: son rutas que _ningún test ejecuta_. Prioridad máxima:
   añadir el test que llega a la ruta (y, si es un error de dominio, afirmar también el
   mensaje: ver punto 3).
2. **Lote B — lógica sobreviviente** (`ConditionalExpression`, `EqualityOperator`,
   `LogicalOperator`, `CallExpression`): añadir el caso límite o la rama que falta.
   Ficheros prioritarios por score: `pricePosition`, `csv`, `optimization`, `testforward/session`,
   `priceExpr`, `guards`, `instrument`, `logFormat`, `metrics`, `spec/validate`.
3. **Lote C — mensajes (`StringLiteral`) — política acordada**: el texto se afirma **solo donde
   es contrato**, es decir en errores de dominio `Invalid*Error`/`*Error` (patrón existente en el
   repo: `toContain('(recibido: -1)')`, `toThrow(/línea 3/)`). Los textos de **log/observabilidad**
   (`logFormat`, `pushLog`) **no se persiguen**: se aceptan como supervivientes.
4. **Mutantes equivalentes**: si un mutante no cambia ningún comportamiento observable, se
   registra aquí con su ubicación. Detectados y **aceptados como Supervivientes** (2026-11-17)
   — _Stryker v10 eliminó `ignoreMutations`_ (sustituido por `ignorers`/plugins, que no cubren
   casos personalizados), así que no se pueden excluir del score: coste ~4 mutantes (−0,15 %).
   - `candle.ts:55` (`value.trim() !== ''` → literal distinto): para whitespace ambos caminos
     devuelven `null` (Number da NaN) y para el resto entran juntos — recorrido completo demostrado.
   - `csv.ts:179` (default `'skip'` → `""`): `(undefined ?? X) === 'throw'` es `false` con ambos.
   - `csv.ts:207` (`find(...) ?? ''` con header perdido): el contenido del header nunca llega a un
     mensaje (usan `ref.column`) ni a la interpolación de columnas.
   - `strategies/spec/build.ts:124` (etiqueta `'exitRule'` en la llamada a `assertRuleOperations`):
     con `operationAliases('exitRule')` = los3 alias de operación, el guard de `assertOperand`
     (`OPERATION_ALIASES.includes(x) && !allowed.includes(x)`) nunca es `true` en ese contexto →
     la etiqueta no puede observarse en ningún mensaje.

## Historial del ratchet

| Fecha      | Score  | `break` | Notas                                                                            |
| ---------- | ------ | ------- | -------------------------------------------------------------------------------- |
| 2026-11-16 | 78,6 % | 73      | Baseline M2 (tras M0/M1 piloto en candles+indicators: 82,3 %)                    |
| 2026-11-17 | 89,6 % | 73      | Tras Lote A + C1–C7 (run full 23m52s: 4393 mutantes, 2414+10 muertos, 267 vivos) |

**Desglose de los267 vivos del run final** (Lote B — lógica): `testforward/session` 52 en el
run full (7 mensajes → muertos en C7 + 1 log aceptado + 44 lógica; el run acotado post-C7 da
48 por varianza de mutantes _timeout_ entre runs), `backtest/metrics` 34,
`portfolio/riskManager` 17, `trading/strategyRunner` 16, `execution/trade` 14,
`backtest/robustness` 13, `candles/csv` 11, `strategies/strategy` 11… Por tipo:
`ConditionalExpression` 128, `EqualityOperator` 40, `CallExpression` 27, `LogicalOperator` 16,
resto <12 c/u.

## Lotes

- [x] **Lote A — NoCoverage (51 mutantes, ~18 rutas)**: csv (columna ausente, timestamp ISO),
      instrument (`equals` con quote distinto), marketContext (`levels` no objeto), session
      (precio no finito, orden rechazada, logs), fingerprint (shapes sin serializar),
      strategyRunner (refresh de salida pendiente), strategy (execution inválido en TP/SL),
      tradingSession (índice inexistente / sin velas), recordingBroker, aliases, logFormat
      (`manual` por defecto), backtest/experiment/optimization/robustness/metrics (mensajes).
  - [x] A1: instrument (`equals` quote), strategy (execution TP/SL), csv (columna ausente ×2,
        fecha ISO inválida) →5 tests nuevos.
- [x] A2: fingerprint (`false` y función), aliases (clave `''`), marketContext (`levels`
      no objeto), recordingBroker (orden nunca enviada), logFormat (módulo nuevo con
      cadenas exactas: su contrato ES el texto) →6 tests.
- [x] A3: strategyRunner (refresh de la salida pendiente con `exitLimitPrice` en el fixture),
      session (precio no finito en overrides TP/SL + rechazo de la salida limit por
      intercalación TP→salida) →3 tests.
- [x] Aceptados como **defensivos / inalcanzables por diseño** (no se pueden matar sin romper
      invariantes; ninguno es código muerto, son guardas legítimas): - `tradingSession.ts:279/294` — índices con la sesión validada ≥1 velas. - `fingerprint.ts:56/57` — `default:` del switch: `typeof` no tiene otros valores. - `marketContext.ts:86` — `current` con `base` siempre en rango (`at()` valida antes). - `session.ts:112` — `releaseOwnOrder('exit')`: la única llamada es `('entry')` (veto). - `session.ts:394` — `reason ?? 'señal'`: toda confirmación lleva `reason` no nulo. - `session.ts:428` (×2) — `submission === null`: **inalcanzable por diseño** — el
      riesgo replica la ejecución (`RiskManager({...risk, ...executionModel.config})`,
      §12C "fuente única de costes"), así que el coste real nunca supera el efectivo
      aprobado; y sin posición no puede existir una confirmación de salida.
      (Intento descartado: forzar rechazo por comisiones NO reservadas → imposible por ese mismo diseño.)
- [x] C1 (NoCoverage de mensaje): `spec/validate` ×7 con la tabla `BAD_SPECS` (spec, entry,
      indicador, takeProfit, triggers, trigger) + `build` ×1 (el nodo `not` hereda las
      restricciones de `entry.rule`) →8 tests.
  - [x] Aceptados como **defensivos** (inalcanzables sin romper invariantes; lo dicen los
        propios comentarios del código): `tradingSession.ts:279` (`candles[index]` con
        `index < length`) y `tradingSession.ts:294` (primera vela con sesión validada ≥1).
  - [x] Aceptados en C1: `backtest:148` (curva vacía con validación ≥1 vela), `replayEngine:134`
        (`?? 'sin motivo'`: `reject` exige motivo), `optimization:71`, `experiment:107` y
        `robustness:95` (los tres con comentario "Inalcanzable" en el código),
        `metrics:180` (`firstPoint`: `assertCurve` lanza primero con el mismo mensaje).
- [ ] **Lote B — lógica sobreviviente** (518 − mensajes): prioridad por score de fichero.
  - [x] **B1** — `testforward/session+confirmationPoints` (48) y `backtest/metrics` (34):
        escritos **16 tests nuevos** (1174 en total). `testforward`:31 muertos en11 tests
        (bloqueo de orden propia en vuelo entrada/salida, veto→reconfirmación, reentrada
        tras cerrar, señal `add` sin confirmación — con velas sin gap i4→i5 para que la
        entrada rellene, confirmación en la última vela, jump detenido en el destino,
        id `t1`, precio limit en calentamiento); `metrics`:22 muertos en8 tests
        (guards de equity no positivo, validación de sharpe, retornos no finitos,
        varianza muestral n−1, empates en expectancy, `sortByMetricDesc`).
        **Aceptados como equivalentes/defensivos** — recorridos demostrados: - `metrics` (18): `+= 0`/`+= -0` en profitFactor, identidad de la media en
        expectancy con `wins = todos`, guards redundantes (`assertX` +
        `firstPoint`/`lastPoint`/`sharpe` interno → mismo error), **`typeof` vs
        `Number.isFinite`** (no coerce → el chequeo de tipo es redundante: L164 y
        session L347), y los **5 mutantes de `sortByMetricDesc`** (empates/`nulls`):
        verificado empíricamente que el sort de V8 **nunca** presenta comparaciones
        de empate con `a.index < b.index` (200 entradas aleatorias, n=4..100 → 0),
        así que `index − b.index`, `index + b.index` y `return 1` tienen siempre el
        mismo efecto; los tests se mantienen como contrato de estabilidad. - `testforward` (17): `confirmation ⇒ awaiting` (L271), sync de jump
        redundante (L305), `sl`/`tp` ausentes del contexto (L149/150), guards
        defensivos inalcanzables (L456, L470-c11-35, L370, L383, L361, L111-true,
        L72, L142) y3 textos de log (`entrada`/`salida`, `reason ??`) por política.
        **Verificación final:89,70 % y exactamente los36 aceptados** (metrics18 +
        session17 + confirmationPoints1); ninguno inesperado.
  - [x] **B2** — `portfolio/riskManager` (17) y `backtest/robustness` (13): run previo
        **85,97 %** con30 vivos → run final **90,95 % y19 vivos** (11 muertos con6 tests
        nuevos →1180 en total): fila NaN de `minCashReserve`, presupuesto positivo <
        cantidad mínima → `null` (entryQty y addQty), coste `unitCost × qty` (no
        inverso) con fee, tope de exposición **exacto + epsilon**
        (`500.000000001` verificado en FP), sensibilidad con valor de rejilla todo-null
        y stdev con3 valores (n−1). **Los19 restantes son equivalentes documentados**:
        robustness (10): typeof vs `Number.isFinite` sin coerción (L52), bounds de
        plateau absorbidos por el lookup de `canonicalJson` (L107×5 + L104 defensivo),
        `means.length === 0` inalcanzable (L146), sort de sensibilidad con el patrón V8
        ya verificado en B1 (L152×2); riskManager (10): guards `funds/budget ≤ 0`
        redundantes con el `qty > 0` (L91×2, L111×2) y `typeof` vs `Number.isFinite`
        sin coerción (L148, L159, L166, L169, L175).
  - [x] **B3** — `trading/strategyRunner` (16), `execution/trade` (14) y
        `execution/fill` (6): run previo **85,19 %** con36 vivos → run final
        **91,77 % y20 vivos** (16 muertos →1192 en total): orderId con solo espacios y
        `time NaN` (fill); filas `entryPrice` string/NaN, `exitPrice` cero, `qty`
        string/NaN, `Trade.from(42)` y timestamp `0` válido (trade); **veto con salida
        pendiente** (la salida nunca se cancela ×3), **add sin duplicar** con orden en
        vuelo (×1) y el **test de doble vía** en test-forward (la salida manual rellena
        mientras el TP del runner sigue en vuelo — único escenario donde el guard de
        `consumeFills` es observable, ×2). **Los20 restantes son equivalentes
        documentados**: typeof vs `Number.isFinite` sin coerción ×9 (fill4 + trade6… de
        los cuales L106/L100 con sus variantes), guards `qty <= 0`/posición
        redundantes con los productores ×4, refresh de `instance.apply` como self-loop
        ×2 (L195/L229), `submitExit` sin posición reenviado por `submitDecisionOrder`
        ×1 (L220), case `None` duplicado sin efecto ×1 (L162), `L168` de solo
        `pendingOrder !== null` (el `null`+`pendingKind null` entra en un cancel no-op)
        ×1 y `L315` self-loop de add ×1.
  - [x] **B4** — `candles` (csv11 + candle9), `replay` (9+speed1), `strategies/strategy`
        (10) y `spec/validate` (9): run previo **92,64 %** con50 vivos → run final
        **97,60 % y15 vivos** (35 muertos con14 tests →1206 en total): `equals` con los4
        campos restantes; strict con línea de solo espacios, `parseRow` de tiempo con
        espacios (recorte antes de parsear), documento en blanco con `columns` nombrados,
        `detectDelimiter` LF y empate; resoluciones que no se re-registran / vuelven a
        registrarse tras `reset` (regla sin estado — el `enterOnce` tiene closure que
        sobrevive al reset), conteos de envíos y rellenos del ciclo completo y orden
        manual + estrategia en el log; `name` con tipo o espacios, `first_since` con
        mensajes (ramas ausentes) y `then` invalidado, regla/precio de entrada y precio
        de trigger literales, toque exacto en ambos lados, venta sin toque, regla
        direccional de venta con precio bajo el low (construcción de trigger `reduce`
        — también mata `isSignalAction`) y nivel TP literal. **Los15 restantes son
        equivalentes documentados**: csv (L179 default `'skip'`, L182 guard `<=` con
        `undefined`, L207 `?? ''`, L213 shift uniforme), speed (typeof vs `Number.isFinite`),
        candle (L55×4 trim, L164 shortcut de `equals`), replay (L85 ids disjuntos
        `m*`/`o*`, L355 `qty` de manualSell inalcanzable), validate (L138 typeof) y
        strategy (L337 `{entry,sl,tp}` → `{}` con solo lecturas doblemente guardadas).
  - [x] **B5** — `priceExpr`6, `guards`6, `fingerprint`5, `optimization`5 y
        `executionModel`5: run previo **86,24 %** con27 vivos → run final **93,58 % y11
        vivos** (16 muertos con8 tests →1214 en total): **test nuevo
        `test/domain/guards.test.ts`** (tablas de `isRecord`/`isFiniteNumber`/
        `isPositiveNumber`), kind desconocido con op válido e hijo izquierdo inválido en
        priceExpr + resultados no finitos (1e600 → Infinity y NaN → null), `undefined` en
        arrays de `canonicalJson`, causa del `OptimizationError` (envuelta en ejecución,
        ausente en validación) + rejilla de exactamente1000 combinaciones (el tope es
        estricto) y fila `feeBps: -1`. **Los11 restantes son equivalentes documentados**:
        typeof vs `Number.isFinite` sin coerción (executionModel L48/L54, guards L8),
        `open === limit` resuelto por la rama de toque con el mismo precio (L97/L100),
        `undefined` → switch `typeof` → `'null'` (L41), spread de `Map` idéntico
        (L82), claves únicas en el sort (L106/L107), división por cero absorbida por
        `isFinite` aguas abajo (L119) y null-check redundante con `Number.isFinite`
        (L100).
- [x] **Lote C — mensajes de error de dominio: COMPLETADO** (subconjunto de los 213
      `StringLiteral`, C1–C7 — política aplicada: texto de contrato de errores `*Error` de
      dominio; logs/observabilidad no se persiguen; ver equivalentes en la sección 4).
  - [x] C1: `spec/validate` ×7 (tabla `BAD_SPECS`) + `build` (rama `not`) →8 tests.
  - [x] C2a — familia `execution` (45 mensajes): columna de mensaje en las tablas (order/trade/
        fill), `name` + dominio (position, executionModel), historicalBroker y recordingBroker.
        Run acotado: **82,1 % → 92,8 %** y **0 mensajes supervivientes** en la familia.
  - [x] C3 — `candles` + `portfolio` (~23): columna de mensaje en las tablas de `riskManager`,
        `name`+dominio en candle/pricePosition/portfolio/riskManager, mensajes de csv/normalize/
        portfolio y tests nuevos (celda vacía, línea en blanco strict, unixSeconds no numérico).
        Run acotado: **normalize y pricePosition → 100 %**, candle 91,1 %, portfolio 93,3 %,
        riskManager 87,5 %, csv 75,9 %.
  - [x] C4 — `backtest` (metrics, optimization, robustness, experiment, backtest): run previo
        **75,08 %** con 15 `StringLiteral` vivos. Añadidos mensajes en las tablas de
        metrics/optimization/robustness + tests `name`+dominio en metrics, backtest y
        optimization, y dominio en los `name` existentes de experiment y robustness.
        Run final: **80,91 % y 0 mensajes vivos** (los 5 `NoCoverage` restantes son los
        defensivos aceptados: backtest:149, experiment:107, metrics:180, optimization:71,
        robustness:95). (+3 tests → 1152).
  - [x] C5 — `strategies` (raíz + spec/): run previo de la raíz **86,06 %** con 29
        `StringLiteral` (marketContext 9, priceExpr 7, strategy 8, strategyInstance 3,
        rules 1, fingerprint 1) y **39 más en spec/** (validate 27, build 11, aliases 1).
        Añadidos mensajes en marketContext/priceExpr/strategy/strategyInstance/rules +
        tests nuevos (`b` inválido en condición, ejecución de trigger, `request_reduce`,
        `takeProfit`/`trigger` con operandos prohibidos) y hash corto `02a36720` en
        fingerprint (el `padStart` solo es observable con hashes <8 dígitos).
        `build.ts:124` (etiqueta `exitRule`) aceptado como **equivalente**: con
        `operationAliases('exitRule')` = los3 alias, `assertRuleOperations` nunca lanza
        allí → la etiqueta no es observable. (+0 tests → 1153, +~90 aserciones).
  - [x] C6 — resto (instrument, constant, replayEngine, speed, marketClock, tradingSession,
        errors): run previo **80,23 %** con **31 `StringLiteral`**. Añadidos: columna de
        mensaje en INVALID de instrument, mensajes de transiciones/pending/fraction de replay
        (con raws comillados: `formatValue` cita los strings), mensajes de config+advance de
        tradingSession, time de marketClock, speed, dominio en los `name` y **test nuevo
        `test/domain/errors.test.ts`** (`formatValue`/`invalidMessage`).
        Run final: **89,83 % y 0 mensajes vivos** (los 33 restantes son lógica/NoCoverage →
        Lote B). (+4 tests → 1157).
  - [x] C7 — `testforward` (laguna detectada en el run full: no estaba en los lotes):
        run previo con **8 `StringLiteral`** de mensajes (super-pair, `decide` sin pausa,
        `awaiting` con raw, `finished` con raw). Añadidos: mensajes en `transiciones
inválidas` + **test nuevo `name`**. Aceptado: `session.ts:393` (label
        `entrada`/`salida` de `pushLog` → texto de log, no se persigue).
        (+1 test → 1158).
- [x] **Lote 0 — infraestructura**: config, ratchet (`break: 73`), este documento.
