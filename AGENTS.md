# AGENTS.md

Guía para agentes que trabajen en este repositorio.

## Proyecto

App de estrategias de trading de criptomonedas: React + TypeScript, toda la lógica en el navegador, datos de precios de una API pública de exchange, persistencia local (sin backend ni cuentas).

## Requisitos y arquitectura

Fuente de verdad de requisitos, decisiones de diseño y roadmap:
[`docs/architecture.md`](docs/architecture.md) — sus números de sección (**§1–§14**) son la
referencia estable citada por el resto de `docs/`; no renumerar.

- Estado de la implementación: [`docs/proyectstate.md`](docs/proyectstate.md)
- Mapa del código (diagramas): [`docs/domain-diagram.md`](docs/domain-diagram.md) — ver
  [Documentación y diagramas](#documentación-y-diagramas)
- Planes por fase y decisiones cerradas: `docs/*-plan.md`; otros registros:
  `docs/mutation-triage.md`, `docs/refactors-no-realizados.md`, `docs/tutorial-estrategias.md`

## Estructura de carpetas

```
src/                  → solo código de la app (nunca tests)
  domain/             → lógica pura (sin React, sin I/O)
  storage/            → repositorios con Storage inyectado
  api/                → adaptadores al exchange (proveedor de velas)
  components/         → componentes React (Atomic Design: pages, templates, organisms,
                        molecules, atoms, hooks, utils)
  main.tsx            → arranque (fija repositorio y proveedor)
test/                 → tests espejo de src/ (mismas carpetas)
  setup.ts            → setup de Vitest
  support/            → helpers/builders compartidos entre tests (no son tests)
  domain/...
  api/...
  components/...
```

Detalle de las capas de componentes: «Estructura de componentes (Atomic Design)» en
[`docs/proyectstate.md`](docs/proyectstate.md).

**Convención de tests:** `src/domain/foo/foo.ts` ↔ `test/domain/foo/foo.test.ts`.
Los tests viven fuera de `src/` para que `src/` sea 100% código de producción.

**Tests legibles:** cada test se lee como _nombre del comportamiento → datos relevantes →
aserción_. Lo común a 2 o más ficheros (fixtures, constructores de entidades, render, seed de
storage) se extrae a `test/support/`. Regla: los helpers **construyen** (nunca contienen
`expect`); el que asienta es el test.

## Imports

Alias `@` → `src/`, configurado en `vitest.config.ts` y `tsconfig.json`:

```ts
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
```

Usar siempre `@/...` en tests y en código de app. No usar imports relativos que suban hacia `src/`.

Excepción: los helpers de `test/support/` se importan con ruta relativa dentro de `test/`
(p. ej. `../../support/candles`). `@/` sigue apuntando exclusivamente a `src/`.

## Gestor de paquetes

**pnpm** (no npm ni yarn). Lockfile: `pnpm-lock.yaml`. Dependencias con scripts de build aprobadas en `pnpm-workspace.yaml` (`allowBuilds`).

```bash
pnpm install       # instalar dependencias
```

## Comandos

```bash
pnpm dev             # servidor de desarrollo (Vite)
pnpm build           # typecheck + build de producción
pnpm test            # Vitest en modo run (CI)
pnpm test:watch      # Vitest en watch
pnpm test:coverage   # Vitest con cobertura V8 (informe + coverage-final.json)
pnpm test:mutation   # Stryker: mutation testing (registro en docs/mutation-triage.md)
pnpm typecheck       # tsc --noEmit (sin errores antes de dar por terminada una tarea)
pnpm imports:check   # imports sin uso en src/ y test/ (exit 1 si hay)
pnpm imports:fix     # eliminar los imports sin uso
pnpm format          # Prettier: formatear todo el repo
pnpm format:check    # Prettier: verificar formato sin escribir (para CI)
pnpm docs:check      # Mermaid: validar los bloques de todos los .md trackeados
```

## Formato

Todo el código pasa por **Prettier** (config en `.prettierrc`: sin punto y coma, comillas simples, 100 columnas, trailing comma).
Antes de dar por terminada una tarea: `pnpm format`. No añadir estilos a mano ni luchar contra el formateador.

## Convenciones de código

- TypeScript estricto (`noUncheckedIndexedAccess` activo): los índices de array pueden ser `undefined`.
- Nombres en inglés para código y tests; el backlog/docs pueden ir en español.
- **Comentarios**: solo cuando expresan **intención** o **contextualizan** — el _porqué_, invariantes,
  trampas, contratos no visibles en el código, referencias a requisitos (§). Un comentario que repite
  el nombre de lo que anota, narra la siguiente línea o explica algo legible en el código es _smell_:
  el arreglo es **renombrar, extraer o eliminar**, nunca comentar más. Si un bloque necesita un
  comentario para entender _qué_ hace, el problema es del código (mal nombre, falta de cohesión).
- Fecha/hora en timestamps Unix en milisegundos (UTC).
- Los errores de dominio son clases con `this.name` (p. ej. `InvalidCandlesError`).

## Al terminar una tarea

```bash
pnpm test && pnpm typecheck && pnpm format:check && pnpm imports:check   # los cuatro en verde
```

Si la tarea ha tocado `src/domain/**` o `src/storage/**`, revisar además
[Documentación y diagramas](#documentación-y-diagramas).

## Documentación y diagramas

`docs/domain-diagram.md` es el mapa de la estructura del código: paquetes y sus dependencias de
importación, clases, jerarquía de errores y flujos de ejecución, en Mermaid. Es documentación viva:
si el código cambia, el diagrama miente.

**Regla: toda tarea que modifique `src/domain/**` o `src/storage/**` debe actualizar el fichero de
diagramas** cuando el cambio afecte a lo que representa:

- paquete nuevo o eliminado (carpeta de `src/domain/`, `src/storage/` o módulo raíz de `src/domain`);
- clase, interfaz o tipo exportado nuevo o eliminado, o **miembros públicos** que cambien de nombre,
  visibilidad o firma (los privados y el cuerpo de las funciones no cuentan);
- error de dominio nuevo o eliminado (sección 3 y su tabla de reparto por paquete);
- dependencia entre paquetes que aparezca o desaparezca (flechas discontinuas **y** su tabla);
- función libre o tipo añadido/retirado en la sección 5.

No requiere actualizarlo: renombrar variables o parámetros internos, cambiar el cuerpo de una función
sin tocar su firma, tests, estilos y `src/components/**`.

Comprobaciones al terminar:

- `pnpm docs:check` — valida los bloques Mermaid con el parser real (`scripts/checkMermaid.mjs`);
  si se añaden etiquetas de arista con paréntesis u otros caracteres especiales, van entre comillas
  dobles;
- las rutas y ficheros citados en el texto existen (nada de símbolos recién eliminados);
- `pnpm format` deja el Markdown conforme.

## Git

**El agente nunca realiza commits.** No ejecuta `git commit` (ni `--amend`) ni ningún comando que
cree o reescriba el historial (`git merge`, `git rebase`, `git cherry-pick`, `git revert`…). Deja el
árbol de trabajo como lo encuentre.

En su lugar, **al terminar una tarea solo sugiere un mensaje de commit** para que lo aplique quien
gestione el repositorio. El mensaje sigue el estilo del historial existente (Conventional Commits):
prefijo `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`…, en inglés, conciso y en imperativo.
