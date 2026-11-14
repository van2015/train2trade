# Plan de previsualización de estrategia (minichart en el editor)

> Viabilidad + diseño de un **minichart dentro del editor de estrategias** que muestre velas,
> indicadores del borrador y los **niveles de operación configurados** (entrada/TP/SL/triggers),
> como feedback visual mientras se configura.
>
> **Estado: completado (2026-11-14)** — T1…T5 + **ampliación D** implementados con TDD;
> `pnpm test && pnpm typecheck && pnpm format:check` en verde (**1034 tests**, 77 archivos) y
> `pnpm build` OK; `proyectstate.md` actualizado. Decisiones cerradas con el usuario:
> **alcance C** (estructura configurada — la lectura inicial A "backtest preview" se descartó),
> **motor de render** (lightweight-charts) y **ubicación (ampliación D)**: el preview se mudó de
> un minichart en la sidebar (demasiado pequeño) al **área principal** — la pestaña Gráfico lo
> muestra en lugar del chart mientras el editor está abierto (ver "Ampliación" al final).
> Pendiente: aplicar los mensajes de commit sugeridos por tarea (AGENTS.md §Git: el agente no
> hace commits).
>
> **Revisión de alcance (2026-11-14):** la lectura inicial "órdenes = backtest preview" se descartó.
> El minichart es **Strategy-centric puro (§14)**: no ejecuta ni simula nada, solo anota la
> estructura configurada sobre las velas.

## Contexto — qué se quería y qué hay ya

"dibujar un minichart para representar la estrategia, velas, indicadores y las ordenes que
intervienen en la estrategia que se va configurando… una previsualización para dar feedback
visual". Traducción de alcance (**opción C**): dibujar _dónde están_ los niveles que la estrategia
usa (entrada limit, TP, SL, triggers), no _cuándo_ se disparan (eso sería simular decisiones =
B, descartado) ni con qué cantidad (backtest = A, descartado).

| Necesidad                         | Estado | Dónde                                                                                          |
| --------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Velas                             | ✅     | `StrategyEditor` ya recibe `candles` (aviso de niveles invertidos)                             |
| Indicadores del draft             | ✅     | `IndicatorSpec` → `buildIndicator` (`spec.ts:651`, hoy **privado**)                            |
| Contexto para evaluar expresiones | ✅     | `MarketContext.from({candles, indicators, levels})` — público                                  |
| Evaluación de `PriceExpr`         | ✅     | `evaluatePriceExpr(expr, context)` — público                                                   |
| Niveles `entry`/`sl`/`tp`         | ✅     | `OperationLevels` + `withLevels`; **sin histórico** (`back > 0 → null`, `marketContext.ts:28`) |
| Líneas horizontales con etiqueta  | ✅     | `series.createPriceLine` (ya usado por `CandleChart` para las líneas 30/70 del RSI)            |
| Mappers a datos de gráfico        | ✅     | `src/components/chartData.ts` (puro, reutilizable)                                             |

### Costes medidos (bench rápido, 1000 velas = `MAX_CANDLES`)

- `strategy.buildContext(candles)` (todos los indicadores): **~0.3 ms** → síncrono en cada
  keystroke, **sin debounce ni `useDeferredValue`**.
- Evaluación de ~6 `PriceExpr` sobre ese contexto: despreciable.

## Decisiones cerradas (con el usuario)

| Decisión             | Elección                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubicación            | **(Revisada por la ampliación D — ver al final)** Original: bajo el `<h3>` de `StrategyEditor` (sidebar, ~276×160px). Resultó demasiado pequeño → ahora vive en el **área principal** mientras se edita.                                                                                          |
| Alcance              | **C — estructura configurada**: velas + indicadores del draft + niveles entrada/TP/SL/triggers **evaluados en la vela actual**. Sin simulación de decisiones, sin órdenes, sin capital, sin comisiones.                                                                                           |
| Motor de render      | **lightweight-charts**: consistencia visual, reutiliza `chartData` y la sincronía de series. La "2ª instancia" original se anuló con la ampliación D: preview y chart se sustituyen (1 instancia siempre).                                                                                        |
| Semántica de niveles | Fiél al dominio: `OperationLevels` no tiene histórico ⇒ niveles = **líneas horizontales punteadas** evaluadas en la última vela (mismo espíritu que `levelWarning`, enmienda 16).                                                                                                                 |
| Entrada hipotética   | TP/SL/triggers pueden referenciar `entry` (alias de operación). Se inyecta `entry = precio límite evaluado` (si `execution === 'limit'`) o `close` de la última vela (si `market`) ⇒ el TP canónico `entry * 1.02` **sí se dibuja**. Queda etiquetado como nivel evaluado con entrada hipotética. |
| Degradación          | **Sin `buildStrategy`**: indicadores y niveles se evalúan uno a uno con try/catch propio. Draft con reglas/alias rotos → sigue mostrando todo lo evaluables; lo omitido se enumera en `note`.                                                                                                     |
| Interacción          | **Sin zoom/scroll** (`handleScale/handleScroll: false`), `fitContent()` al cambiar velas, sin leyenda ni volumen: el preview es un overview fijo. (En la sidebar valía para no robar la rueda del scroll; en el área principal se mantiene por coherencia con el overview.)                       |
| TP/SL invertidos     | El aviso `level-warning` existente **no cambia** (fuera de alcance); ver follow-up T6 para unificarlo con la evaluación del preview.                                                                                                                                                              |
| Fuera de alcance     | Marcadores de trades/órdenes, señales por vela, equity, métricas, ventana "últimas N velas".                                                                                                                                                                                                      |

### Por qué NO backtest (lección de la revisión)

Las órdenes son una capa de **ejecución**: el único camino spec → `Order[]` es `runBacktest`, y
sus órdenes dependen de capital/comisiones/riesgo que **no pertenecen al editor** → el preview
dejaría de ser una propiedad de la estrategia y convertiría el editor en un experimento no
registrado (§9/§14: Experimentation separado de Strategy Design). Descartado.

## Contratos propuestos

```ts
// T1 — exportar el constructor de indicadores (hoy privado en spec.ts)
// src/domain/strategies/spec.ts
export function buildIndicator(spec: IndicatorSpec): Indicator

// T1 — módulo puro de preview (patrón chartData.ts/backtestForm.ts)
// src/components/strategyPreview.ts
export interface PreviewLevel {
  /** Estable para sincronizar `IPriceLine`: 'entry' | 'tp' | 'sl' | 'trigger-0'… */
  id: string
  /** Etiqueta en el eje: 'Entrada' | 'Take profit' | 'Stop loss' | 'Trigger 1'… */
  label: string
  price: number
  color: string
}
export interface StrategyPreview {
  lines: ChartLine[] // indicadores del draft (pane/color ya resueltos)
  levels: PreviewLevel[] // niveles evaluados en la vela actual
  note: string | null // qué se omitió, o "Sin datos para previsualizar"
}
export function buildStrategyPreview(
  candles: readonly Candle[],
  spec: StrategySpec,
): StrategyPreview
export function buildPreviewLines(
  candles: readonly Candle[],
  spec: StrategySpec,
): {
  lines: ChartLine[]
  issues: string[] // indicador omitido, con motivo
}
export function buildPreviewLevels(
  candles: readonly Candle[],
  spec: StrategySpec,
): {
  levels: PreviewLevel[]
  issues: string[]
}
```

### Algoritmo de niveles (puro, sin `buildStrategy`)

```
1. indicators[alias] = spec.indicators → buildIndicator → calculate(candles)   (try/catch por uno)
2. ctx0 = MarketContext.from({ candles, indicators })                          (try/catch global)
3. entryHyp = spec.entry.execution === 'limit'
       ? evaluatePriceExpr(spec.entry.price, ctx0) ?? lastClose                (expr sin alias de operación)
       : lastClose
4. ctx1 = ctx0.withLevels({ entry: entryHyp })
   tp = spec.takeProfit ? evaluatePriceExpr(spec.takeProfit.price, ctx1) : null
   sl = spec.stopLoss   ? evaluatePriceExpr(spec.stopLoss.price,   ctx1) : null
5. ctx2 = ctx1.withLevels({ tp, sl })
   triggers[i] = evaluatePriceExpr(spec.triggers[i].price, ctx2)               (pueden usar entry/sl/tp)
6. Cada evaluación null o que lanza (alias de indicador omitido, calentamiento)
   ⇒ nivel omitido + issue; nunca rompe el resto.
```

Colores: reutiliza `CHART_COLORS` — entrada `sma` (#2962ff), TP `up` (#26a69a), SL `down`
(#ef5350), triggers `ema` (#ff9800). Todas las líneas **punteadas** (`LineStyle.Dashed`) con
`axisLabelVisible: true` y `title` = etiqueta (patrón de `referenceLines` en `CandleChart.tsx:169`).

`buildPreviewLines` (pane de indicadores):

- SMA/EMA → pane `price`; RSI → `lower` + rango fijo 0–100 + referenciales 30/70;
- `const` → pane según rango: valor dentro de `[min low, max high]` de las velas ⇒ `price`,
  si no ⇒ `lower` (umbral de oscilador); rango fijo acotado para no partir la escala;
- `id` por **índice** (los alias pueden duplicarse mientras se teclea); color por kind con
  rotación de paleta para duplicados.

```ts
// T2 — extraer lo compartido con CandleChart (una sola fuente de sincronía de series)
// src/components/lineSeries.ts
export function lineOptions(line: ChartLine): LineSeriesOptions // movido de CandleChart.tsx
export function syncLineSeries(
  chart: IChartApi,
  store: Map<string, ISeriesApi<'Line'>>,
  lines: readonly ChartLine[],
): void

// T3 — componente (sin `timeframe`: no hay backtest)
// src/components/StrategyPreviewChart.tsx
export interface StrategyPreviewChartProps {
  candles: readonly Candle[]
  spec: StrategySpec
}
// useMemo(buildStrategyPreview) síncrono → createChart (sin legend/volumen/scroll/scale)
// + serie de velas + syncLineSeries + sync de PriceLines (Map<id, IPriceLine>)
// + <p data-testid="preview-note"> para el note

// T4 — integración: SIN props nuevas (el editor ya recibe candles)
// StrategyEditor: render bajo el <h3>; App: anotar el comentario de "dos instancias"
```

## Tareas (TDD: firma + tests en rojo → implementación → verde → gates)

### T1 — Módulo puro `strategyPreview.ts`

- **Archivos:** `src/components/strategyPreview.ts` ↔ `test/components/strategyPreview.test.ts`
  (nuevo) + export de `buildIndicator` en `src/domain/strategies/spec.ts`.
- `buildPreviewLines`: pane/color por kind, degradación por indicador roto, `id` por índice.
- `buildPreviewLevels`: algoritmo de arriba — entrada hipotética (limit/close), TP/SL con
  `entry`, triggers con `entry/sl/tp`; nivel no evaluables ⇒ issue, nunca excepción.
- `buildStrategyPreview` concatena issues → `note` (`"Omitidos: …"` / `"Sin datos…"`).
- **Aceptación:** determinismo (misma entrada → mismo preview); draft con **regla de entrada rota**
  sigue produciendo líneas y niveles (no usa `buildStrategy`); TP canónico `entry * 1.02` se
  evalúa con `entryHyp = close`; expresión con alias de indicador omitido ⇒ issue + resto intacto.

### T2 — Extracción `lineSeries.ts`

- **Archivos:** `src/components/lineSeries.ts` (nuevo), refactor de `CandleChart.tsx`; los tests
  existentes de `CandleChart` deben seguir verdes **sin editar aserciones** (red de seguridad).
- Mueve `lineOptions` + el bucle de sincronía (crear/quitar/actualizar series + `createPriceLine`
  de `referenceLines`) que hoy vive en `CandleChart.tsx:33-49` y `147-184`.
- **Aceptación:** `pnpm test` en verde con solo mover código.

### T3 — Componente `StrategyPreviewChart`

- **Archivos:** `src/components/StrategyPreviewChart.tsx` ↔ `test/components/StrategyPreviewChart.test.tsx`
  (nuevo; mock de `lightweight-charts` con `vi.hoisted` — patrón de `CandleChart.test.tsx`, que ya
  incluye `createPriceLine`/`removePriceLine` en el mock de series).
- `createChart` una vez (sin leyenda/volumen, `handleScale/handleScroll: false`, `fitContent` al
  cambiar velas); efecto de líneas con `syncLineSeries`; efecto de niveles con `Map<id, IPriceLine>`
  (quitar los que desaparecen, `applyOptions` de los que cambian, crear los nuevos); `note` como
  `<p data-testid="preview-note">`; vacío como `data-testid="preview-empty"`.
- **Aceptación:** `setData` con las velas, `createPriceLine` con precio/color/estilo de cada nivel,
  desaparece el TP al borrarlo del editor, nota visible cuando un nivel no evalúa.

### T4 — Integración en el editor

- **Archivos:** `StrategyEditor.tsx` (render bajo el `<h3>`, sin props nuevas),
  `App.tsx` (anotar el comentario de "dos instancias" de `:375` con la excepción del preview),
  `styles.css` (`.strategy-preview` 160px + `.strategy-preview__canvas` + `.strategy-preview__note`).
- Tests: `StrategyEditor.test.tsx` (presencia del preview + degradación con draft roto).
- **Aceptación:** abrir el editor muestra velas+indicadores+niveles; colapsar la sección y
  reabrirla restaura el gráfico (ResizeObserver de `autoSize`); cerrar el editor desmonta la 2ª
  instancia.

### T5 — Documentación

- **Archivos:** `docs/proyectstate.md` (sección nueva + contador de tests), este plan (estado).
- Gates: `pnpm test && pnpm typecheck && pnpm format:check` en verde.

## Riesgos y follow-ups

- **2ª instancia de lightweight-charts** (decidido en la propuesta original): **superado por la
  ampliación D** — el preview sustituye al chart, así que ahora vuelve a haber 1 sola instancia
  y este riesgo queda anulado.
- **Entrada hipotética:** la anotación `entry = close` (market) es una convención de preview, no
  semántica de dominio; el `note`/leyenda debe hacerla explícita para no confundir.
- **`constPane` es un heuristic** (constante dentro del rango de precios ⇒ price, si no ⇒ lower);
  validar visualmente "umbral de RSI" vs "umbral de precio".
- **T6 (follow-up):** unificar `levelWarning` del editor con `buildPreviewLevels` — hoy el aviso
  no evalúa TP/SL que referencian `entry` (contexto sin niveles ⇒ `null` ⇒ sin aviso); con la
  entrada hipotética detectaría también `TP = entry * 1.02` invertido respecto a `SL`.
- **Follow-ups:** ventana "últimas N velas" (si la densidad de ~1000 velas en ancho completo
  resulta intensa), leyenda compacta al hover, señales/marcadores como capa opcional (B/A) si se
  quiere feedback de disparos, botón de expandir (overlay) si se quiere ver el chart y el preview
  a la vez.

## Ampliación: superficie del preview (opción D, completada 2026-11-14)

El minichart de la sidebar (276×160px) resultó **demasiado pequeño**. Decisiones cerradas con el
usuario (tras presentar 4 opciones):

| Decisión                      | Elección                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Superficie                    | **D — preview en el área principal**: mientras el editor está abierto, la pestaña `Gráfico` muestra `StrategyPreviewChart` **en lugar de** `CandleChart` (patrón split formulario↔resultados ya existente). Auto-conmutación a `Gráfico` **solo al abrir** el editor. |
| Minichart de la sidebar       | **Eliminado** (preview único): `StrategyEditor` ya no lo monta.                                                                                                                                                                                                       |
| Invariante de instancia única | **Recuperado sin excepciones**: preview y chart se sustituyen, nunca conviven. Se retiró la anotación de "excepción deliberada" de T4 en `App.tsx`.                                                                                                                   |
| Datos del preview             | `visible` (no `candles`): respeta el recorte de sesión activa, igual que el chart que sustituye.                                                                                                                                                                      |

**Flujo de datos** (el draft vive en `StrategyEditor`, sube por la cadena):

```ts
// StrategyEditor: + onDraftChange?: (spec: StrategySpec) => void
useEffect(() => onDraftChange?.(draft), [draft]) // sin buildStrategy, sin excepciones
// StrategyPanel: + onEditingChange?: (spec: StrategySpec | null) => void
//   openNew/openEdit → spec · close (guardar/cancelar) → null · cambios del editor → reenviados
// App: editingSpec: StrategySpec | null
//   handleEditingChange: setEditingSpec + setMainView('chart') SOLO en null → spec
//   (cambios de draft y cierre no tocan la pestaña — testeado)
// Pestaña Gráfico: editingSpec !== null ? <StrategyPreviewChart candles={visible} …/> : <CandleChart …/>
```

- CSS: `.strategy-preview` pasa de `height: 160px` a `flex: 1; min-height: 0` (llena la vista).
- Tests: **+8 netos** (1034 total): 4 editor (notificación en cambio/deshacer/regla rota + el
  preview ya no vive en la sidebar), 3 panel (`onEditingChange`: abrir/cambiar/cerrar y error al
  guardar no emite null), 5 App (swap en la pestaña Gráfico, auto-conmutación desde otra pestaña,
  draft en vivo → `preview-note`, restauración del chart al cerrar, los cambios de draft no roban
  la pestaña). Retirados los 4 tests del minichart-en-sidebar.
- T4 del plan original queda **parcialmente sustituido**: el preview ya no se monta bajo el `<h3>`
  del editor ni anota una "excepción" de instancia; la integración ahora es vía
  `onEditingChange`/`editingSpec` en `App`.
