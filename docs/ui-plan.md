# Plan de mejora UI — sidebar colapsable y vistas con espacio propio

> Plan de reestructuración de la navegación y del aprovechamiento del espacio.
>
> **Estado: completado (2026-11-13)** — T0…T6 (Fases 1 y 2) y la **Fase 3** implementados en la
> rama `ui-plan`; `pnpm test && pnpm typecheck && pnpm format:check` en verde (**795 tests**,
> 65 archivos).
> Decisiones cerradas con el usuario: **secciones colapsables**, **resultados con prioridad en el
> área principal**, **solo desktop** (sin nuevo trabajo responsive), **resultados en pestañas**.
> Fase 3: **Replay con gráfico integrado en su pestaña**, **formularios en la sidebar → resultados
> en sus pestañas**, Historial como pestaña (sección `resultados` eliminada del sidebar).

## Contexto — problema actual

- **No hay menú ni router**: `src/components/App.tsx:146-194` renderiza un `<aside
className="app__sidebar">` con **8 paneles apilados, todos visibles siempre**, en una columna de
  **300px** (`styles.css:80-90`): Datos de mercado, Importar CSV, Indicadores, Backtest, Replay,
  Historial, Test-Forward y Optimización.
- El área principal (`app__main`) solo aloja `CandleChart`. Los **resultados de backtest**
  (tabla de métricas, equity curve de 160px fijos, tabla de trades) van **estrujados dentro de los
  300px** del sidebar; lo mismo afecta a Replay (370 líneas de UI), Optimización (332),
  Test-Forward (225) e Historial (181).
- Estilos: un único `src/styles.css` global (BEM-ish, variables en `:root`, un solo breakpoint
  `860px` en `styles.css:367-382`). Sin router, sin librerías de UI.
- **Ningún test referencia `app__sidebar`, `<aside>` ni `panel-title`** (grep de `test/`): la
  reestructuración no rompe contratos de dominio, solo puede afectar a queries de UI en
  `App.test.tsx` y `BacktestPanel.test.tsx`.

## Decisiones cerradas

| Decisión           | Elección                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navegación         | **Acordeón de secciones** en el sidebar: Fase 1 con 3 (`Datos` · `Experimentos` · `Resultados`); **Fase 3 deja 2**: `Datos` (mercado, CSV, indicadores) y `Experimentos` (formularios de backtest, test-forward y optimización). La sección `Resultados` se elimina: Historial es una pestaña.                                |
| Estado inicial     | Por defecto **`Datos` abierta**, el resto cerradas; **una sola abierta a la vez** (acordeón estricto).                                                                                                                                                                                                                        |
| Montaje de paneles | Los paneles de una sección cerrada **siguen montados** y se ocultan con CSS (`display: none` + `aria-hidden`): no se pierde el estado (formularios, resultados). En la Fase 3 el mismo truco aplica a las vistas **Replay** (sesión) e **Historial** (selección de comparación), que permanecen montadas fuera de su pestaña. |
| Persistencia       | Sección abierta persistida en `localStorage` (helper con `Storage` inyectado, fallo tolerado → estado en memoria). Clave `ui:sidebar-section`.                                                                                                                                                                                |
| Sin router         | Conmutador de vista **por estado React** en `App` (`mainView`), no se introduce react-router.                                                                                                                                                                                                                                 |
| Área principal     | **Barra de pestañas** en `app__main`: Fase 2 con `Gráfico \| Backtest`; **Fase 3 amplía a 6**: `Gráfico \| Backtest \| Replay \| Test-Forward \| Optimización \| Historial`.                                                                                                                                                  |
| Auto-conmutación   | Al ejecutar **cualquier experimento** con éxito (backtest, test-forward, optimización) la UI **salta a la pestaña de sus resultados**, que además muestra un punto indicador.                                                                                                                                                 |
| Split de paneles   | Cada experimento se divide: **formulario en la sidebar** (`BacktestPanel`, `TestForwardPanel`, `OptimizationPanel` con `onResult`) y **resultados en su pestaña** (`BacktestResults`, `TestForwardResults`, `OptimizationResults`).                                                                                           |
| Replay             | **Pestaña con gráfico integrado**: `ReplayPanel` (controles, progreso, manuales, log) a la izquierda + `CandleChart` recortado a la derecha. La vista queda montada en `hidden` para no perder la sesión al cambiar de pestaña.                                                                                               |
| Historial          | `ExperimentHistoryPanel` se muda **entero** a la pestaña Historial (sin split: no tiene formulario).                                                                                                                                                                                                                          |
| Responsive         | **Sin cambios**: se mantiene el breakpoint 860px existente (solo desktop es el objetivo; en ≤860px la pestaña Replay apila controles sobre el gráfico).                                                                                                                                                                       |
| Status global      | El mensaje `status` (descarga/CSV) se mantiene **al pie del sidebar**, fuera de las secciones.                                                                                                                                                                                                                                |

## Contratos propuestos

```ts
// T0 — sección plegable del sidebar (Fase 3: se eliminó 'resultados')
// src/components/SidebarSection.tsx
export type SidebarSectionId = 'datos' | 'experimentos'
export interface SidebarSectionProps {
  id: SidebarSectionId
  title: string
  /** true → contenido visible; el botón expone aria-expanded. */
  open: boolean
  onToggle: (id: SidebarSectionId) => void
  children: React.ReactNode
}
// Cabecera es <button type="button" aria-expanded={open} aria-controls={`${id}-content`}>
// Contenido en <div id={`${id}-content`} hidden={!open}> — hidden = display:none,
// pero los hijos siguen montados (decisión de montaje, ver arriba).

// T1/T2 — persistencia del estado plegado (mismo patrón que los repositorios)
// src/storage/sidebarState.ts
export function loadOpenSection(storage: Storage | null): string | null // sin clave/fallo → null
export function saveOpenSection(storage: Storage | null, id: string | null): void // null → borra; fallo → no-op
// La validación vive con el tipo, en el componente (evita que storage conozca la UI):
// src/components/SidebarSection.tsx
export const SIDEBAR_SECTION_IDS: readonly SidebarSectionId[]
export function isSidebarSectionId(value: unknown): value is SidebarSectionId

// T2/Fase 3 — conmutador de vista del área principal
// src/components/MainTabs.tsx
export type MainViewId =
  'chart' | 'backtest' | 'replay' | 'testforward' | 'optimization' | 'history'
export interface MainTabsProps {
  active: MainViewId
  onChange: (view: MainViewId) => void
  /** Vistas con resultados → punto indicador en la pestaña. */
  results: Partial<Record<MainViewId, boolean>>
}

// T3/Fase 3 — split de cada experimento: formulario (sidebar) + resultados (pestaña)
// src/components/BacktestPanel.tsx / TestForwardPanel.tsx / OptimizationPanel.tsx
export interface BacktestPanelProps {
  // ...las actuales (candles, timeframe, instrument)...
  /** Auto-guardo en el historial (existente). */
  onExperiment?: (experiment: Experiment) => void
  /** Último resultado para que App lo muestre en su pestaña. */
  onResult?: (experiment: Experiment) => void
}
// TestForwardPanel: onExperiment (×2: dev + eval) + onResult?: (run: TestForwardRun) => void
// OptimizationPanel: onResult?: (view: OptimizationViewState) => void

// src/components/BacktestResults.tsx / TestForwardResults.tsx / OptimizationResults.tsx
export interface BacktestResultsProps {
  /** null → estado vacío ("Ejecuta un backtest..."). */
  experiment: Experiment | null
}
export interface TestForwardResultsProps {
  run: TestForwardRun | null // null → "Ejecuta un test-forward..."
}
// OptimizationResults.tsx también exporta el tipo que produce el formulario:
export interface OptimizationViewState {
  optimization: OptimizationResult
  robustness: RobustnessReport | null
  note: string | null
}
export interface OptimizationResultsProps {
  view: OptimizationViewState | null // null → "Ejecuta una optimización..."
}
```

Estado nuevo en `App`:

```ts
// uiStorage?: Storage | null — prop opcional; por defecto, window.localStorage (con fallback null)
const [openSection, setOpenSection] = useState<SidebarSectionId | null>(
  () => normalize(loadOpenSection(storage)) ?? 'datos', // isSidebarSectionId → fallback 'datos'
)
const [mainView, setMainView] = useState<MainViewId>('chart')
const [lastExperiment, setLastExperiment] = useState<Experiment | null>(null)
const [lastTestForward, setLastTestForward] = useState<TestForwardRun | null>(null)
const [lastOptimization, setLastOptimization] = useState<OptimizationViewState | null>(null)
// handleToggleSection: acordeón (abrir cierra la anterior; click en la abierta la cierra)
// handleBacktestResult / handleTestForwardResult / handleOptimizationResult:
//   guardan el resultado y conmutan a su pestaña (auto-conmutación)
```

## Estructura resultante (Fase 3)

```
┌──────────────────────────────┬──────────────────────────────────────────────┐
│ sidebar (300px)              │ app__main                                   │
│ ┌──────────────────────────┐ │ ┌──────────────────────────────────────────┐ │
│ │ ▸ Datos                 │ │ │ [Gráfico][Backtest][Replay][Test-Forward]│ │
│ │ ▾ Experimentos          │ │ │ [Optimización][Historial]    BTC · 1h     │ │
│ │   (form backtest,       │ │ ├──────────────────────────────────────────┤ │
│ │    test-forward,        │ │ │ pestaña activa:                          │ │
│ │    optimización)        │ │ │  Gráfico → CandleChart (flex)            │ │
│ └──────────────────────────┘ │ │  Backtest → métricas + equity + trades   │ │
│ status                       │ │  Replay → ReplayPanel | CandleChart      │ │
│                              │ │  Test-Forward → tabla dev/eval/Δ         │ │
│                              │ │  Optimización → runs + robustez          │ │
│                              │ │  Historial → panel completo              │ │
│                              │ └──────────────────────────────────────────┘ │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

## Tareas (TDD: firma + tests en rojo → implementación → verde → gates)

### T0 — Componente `SidebarSection`

- **Archivos:** `src/components/SidebarSection.tsx` ↔ `test/components/SidebarSection.test.tsx`.
- Cabecera-botón con título, chevron (▸/▾ vía clase), `aria-expanded`/`aria-controls`; contenido
  con `hidden={!open}` para que los hijos **no se desmonten** al plegar.
- **Aceptación:** toggle dispara `onToggle(id)`; cerrado → contenido no visible en a11y tree pero
  montado (el estado interno de un hijo sobrevive al ocultarlo y recuperarlo).

### T1 — Acordeón en `App` y agrupación de los 8 paneles

- **Archivos:** `src/components/App.tsx` (reestructura del `<aside>`), `src/styles.css`.
- Los 8 paneles pasan a vivir dentro de 3 `SidebarSection` (`datos`, `experimentos`,
  `resultados`); acordeón estricto en `openSection` (default `'datos'`); `status` queda al pie,
  fuera de las secciones.
- Estilos nuevos: `.sidebar-section`, `.sidebar-section__header`, `.sidebar-section__content`;
  se **elimina** el `gap: 16px` global entre paneles a favor de bordes/espaciado de sección.
- **Aceptación:** con la app cargada solo se ven 3 cabeceras + una sección abierta; cambiar de
  sección preserva el estado de las demás (formularios, sesión de replay, resultados).

### T2 — Persistencia de la sección abierta

- **Archivos:** `src/storage/sidebarState.ts` ↔ `test/storage/sidebarState.test.ts` (nuevo).
- `load`/`save` con `Storage` inyectado (patrón `CandleRepository`); JSON corrupto → `null`;
  `save` en try/catch (modo privado / cuota → no-op, la app no debe fallar por esto).
- `App` lo usa con `window.localStorage` (prop opcional para tests); id desconocido en storage →
  fallback `'datos'`.
- **Aceptación:** roundtrip `save → load`; storage roto o lanzando → la app arranca igual con el
  default.

### T3 — Split `BacktestPanel` (formulario) / `BacktestResults` (resultados)

- **Archivos:** `src/components/BacktestPanel.tsx` (pierde la sección de resultados),
  `src/components/BacktestResults.tsx` (nuevo) ↔ `test/components/BacktestPanel.test.tsx`
  (ajustado) + `test/components/BacktestResults.test.tsx` (nuevo), `App.tsx` (estado
  `lastExperiment`).
- El formulario conserva validación, errores inline y el botón; al éxito llama a
  `onExperiment` (auto-guardo, existente) **y** `onResult` (nuevo). `App` guarda el experimento
  y conmuta a `mainView: 'backtest'`.
- `BacktestResults` renderiza: `backtest-summary`, tabla `backtest-metrics`, `EquityChart` y tabla
  `backtest-trades` **con los mismos `data-testid` actuales** (los tests E2E/`App.test` no cambian
  de semántica).
- **Aceptación:** ejecutar un backtest desde la sidebar muestra los resultados en el área
  principal en la pestaña Backtest; plegar/reabrir la sección Experimentos no borra el resultado;
  un test-forward u optimización **no** conmutan la pestaña (solo `onResult` del backtest).

### T4 — Pestañas `Gráfico | Backtest` en el área principal

- **Archivos:** `src/components/MainTabs.tsx` ↔ `test/components/MainTabs.test.tsx`, `App.tsx`,
  `styles.css`.
- Barra de pestañas integrada en/encima de `.app__chart-header`: pestañas a la izquierda,
  instrumento · rango a la derecha (sigue siendo relevante en ambas). Pestaña Backtest sin
  resultados → estado vacío centrado ("Ejecuta un backtest para ver los resultados aquí").
- `CandleChart` solo se renderiza en la pestaña Gráfico (evita mediciones en contenedor oculto);
  `BacktestResults` solo en Backtest.
- **Aceptación:** cambiar de pestaña no altera datos ni estado; el rango de velas visible
  (`N velas`) y el header del instrumento se mantienen; teclado accesible (roles
  `tablist`/`tab`/`tabpanel`).

### T5 — Layout de resultados a ancho completo + limpieza de estilos

- **Archivos:** `src/styles.css`.
- `.backtest-results`: rejilla `grid-template-columns: minmax(260px, 1fr) 2fr` → métricas (izq) y
  equity curve (der, **alto libre ~240px**, fin del fijo 160px); tabla de trades a ancho completo
  debajo con `.panel-scroll` (scroll vertical propio, filas largas no empujan la equity).
- Revisar `.backtest-form` (hoy rejilla 2 columnas pensada para 300px): en la sidebar se mantiene
  compacta; tablas heredadas (`.backtest-metrics`, `.backtest-trades`) conservan clases para no
  romper tests.
- **Aceptación:** sin scroll horizontal en 1280px–1920px; la equity curve usa el ancho disponible;
  `pnpm format` aplicado.

### T6 — Ajuste de tests existentes y documentación

- **Archivos:** `test/components/App.test.tsx`, `docs/proyectstate.md`.
- `App.test.tsx`: helper `openSection(title)` (click en la cabecera) para las assertions que usan
  `getByRole` dentro de secciones cerradas (p. ej. `Ejecutar test-forward`, `Ejecutar
optimización`, `Ejecutar backtest`); las assertions de resultados (`backtest-summary`,
  `backtest-metrics`, `backtest-trades`) siguen verdes gracias a la auto-conmutación.
- `BacktestPanel.test.tsx`: las assertions de resultados se mueven a `BacktestResults.test.tsx`;
  el panel pasa a probar formulario + callbacks (`onResult` disparado con el experimento).
- `proyectstate.md`: registrar el cierre del plan.
- **Aceptación:** `pnpm test && pnpm typecheck && pnpm format:check` en verde.

## Fase 3 — completada (2026-11-13)

Decisiones cerradas con el usuario antes de implementar:

| Decisión    | Elección                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Replay      | **Pestaña con gráfico integrado**: `ReplayPanel` + `CandleChart` recortado juntos (el replay no se puede observar sin mercado). |
| Formularios | **Forms en sidebar → resultados en pestañas** (mismo patrón que el backtest). Historial se muda entero a su pestaña.            |

Tareas implementadas:

- **F3.1 — `MainTabs` a 6 pestañas** (`chart`, `backtest`, `replay`, `testforward`,
  `optimization`, `history`) con indicador de resultados por pestaña (`results:
Partial<Record<MainViewId, boolean>>`, testid `main-tabs-dot-<id>`).
- **F3.2 — Split de Test-Forward**: `TestForwardPanel` (formulario + `onResult`) →
  `TestForwardResults` (resumen + tabla dev/eval/Δ, mismos testids `tf-*`).
- **F3.3 — Split de Optimización**: `OptimizationPanel` (rangos + cap + `onResult`) →
  `OptimizationResults` (runs ordenados + robustez, mismos testids `opt-*`); el tipo
  `OptimizationViewState` se exporta desde el componente de resultados.
- **F3.4 — Historial como pestaña**: `ExperimentHistoryPanel` entero en la vista `history`
  (montada en `hidden` para conservar la selección de comparación); se elimina la sección
  `resultados` del sidebar y `SidebarSectionId` pasa a `'datos' | 'experimentos'`.
- **F3.5 — Replay como pestaña con gráfico**: la vista `replay` permanece montada en `hidden`
  (la sesión no se pierde al cambiar de pestaña) y solo monta `CandleChart` mientras está activa
  (una sola instancia de lightweight-charts). Layout panel(320px) | gráfico; en ≤860px se apila.
- **F3.6 — Auto-conmutación generalizada**: `onResult` en los tres formularios → App guarda el
  resultado y salta a la pestaña correspondiente; tests de integración en `App.test`.
- **F3.7 — Tests**: nuevos `TestForwardResults.test` (3) y `OptimizationResults.test` (3);
  `TestForwardPanel.test`/`OptimizationPanel.test` pasan a harness de integración;
  `App.test` actualizado a 2 secciones y 6 pestañas.

**Aceptación:** `pnpm test && pnpm typecheck && pnpm format:check` en verde (**795 tests**,
65 archivos).

## Fuera de alcance (siguientes rondas)

- Router, responsive nuevo, rediseño visual del tema, iconos en las cabeceras.
- Mover también los **formularios** a sus pestañas (hoy viven en la sidebar por decisión).

## Riesgos

| Riesgo                                                          | Mitución                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Plegar una sección desmonta paneles y pierde estado (replay)    | Montaje permanente con `hidden`/`display: none` (T0): decisión explícita y test de regresión.                       |
| Tests con `getByRole` fallan con paneles ocultos                | Helper `openSection` en `App.test` (T6); grep de `getByRole` sobre los 8 paneles para identificar todos los puntos. |
| Auto-conmutación sorprende al usuario                           | Solo con éxito en un experimento; la pestaña es un click de volver; se documenta en las aceptaciones de T3/F3.6.    |
| `localStorage` no disponible (cuota/modo privado)               | `save` en try/catch + default `'datos'` (T2).                                                                       |
| Chart oculto con `display: none` (resize de lightweight-charts) | `CandleChart` solo montada en su pestaña (T4), evita el problema de raíz.                                           |

## Gates de cierre

```bash
pnpm test && pnpm typecheck && pnpm format:check   # los tres en verde
```

## Mensajes de commit sugeridos (AGENTS.md §Git: el agente no hace commits)

- `feat: add collapsible sidebar sections` (T0–T2)
- `feat: move backtest results to main area tabs` (T3–T5)
- `test: adapt sidebar and backtest UI tests` (T6)
- `feat: move replay, test-forward, optimization and history to main-area tabs` (Fase 3)
