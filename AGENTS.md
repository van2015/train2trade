# AGENTS.md

Guía para agentes que trabajen en este repositorio.

## Proyecto

App de estrategias de trading de criptomonedas: React + TypeScript, toda la lógica en el navegador, datos de precios de una API pública de exchange, persistencia local (sin backend ni cuentas).

- Backlog con historias de usuario: [`backlog.md`](backlog.md)
- Plan de tests por historia: [`tests.md`](tests.md)

## Estructura de carpetas

```
src/                  → solo código de la app (nunca tests)
  domain/             → lógica pura (sin React, sin I/O)
  storage/            → repositorios con Storage inyectado
  components/         → componentes React
test/                 → tests espejo de src/ (mismas carpetas)
  setup.ts            → setup de Vitest
  domain/...
  components/...
```

**Convención de tests:** `src/domain/foo/foo.ts` ↔ `test/domain/foo/foo.test.ts`.
Los tests viven fuera de `src/` para que `src/` sea 100% código de producción.

## Imports

Alias `@` → `src/`, configurado en `vitest.config.ts` y `tsconfig.json`:

```ts
import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
```

Usar siempre `@/...` en tests y en código de app. No usar imports relativos que suban hacia `src/`.

## Gestor de paquetes

**pnpm** (no npm ni yarn). Lockfile: `pnpm-lock.yaml`. Dependencias con scripts de build aprobadas en `pnpm-workspace.yaml` (`allowBuilds`).

```bash
pnpm install       # instalar dependencias
```

## Comandos

```bash
pnpm test           # Vitest en modo run (CI)
pnpm test:watch     # Vitest en watch
pnpm typecheck      # tsc --noEmit (sin errores antes de dar por terminada una tarea)
pnpm format         # Prettier: formatear todo el repo
pnpm format:check   # Prettier: verificar formato sin escribir (para CI)
```

## Formato

Todo el código pasa por **Prettier** (config en `.prettierrc`: sin punto y coma, comillas simples, 100 columnas, trailing comma).
Antes de dar por terminada una tarea: `pnpm format`. No añadir estilos a mano ni luchar contra el formateador.

## Flujo TDD (obligatorio para lógica de dominio)

1. **Rojo:** escribir el/los test(s) en `test/domain/**` → ejecutar → ver fallar.
2. **Verde:** implementar en `src/domain/**` → todos los tests pasan.
3. **Refactor:** limpiar sin cambiar comportamiento → `pnpm test` + `pnpm typecheck` + `pnpm format`.

Reglas:

- Nunca escribir la implementación antes del test en `src/domain/`.
- Cada test debe verificar un comportamiento observable, no detalles internos.
- Casos borde siempre (vacío, null, límites, 0 trades, NaN…).
- Test de propiedades con `fast-check` cuando aplique (determinismo, invariantes).
- **Anti-lookahead:** toda decisión del backtest solo usa datos con `time <= tiempoActual`.

## Capas y qué testear

| Capa                  | Dónde               | Cómo                                         |
| --------------------- | ------------------- | -------------------------------------------- |
| Lógica pura (dominio) | `src/domain/**`     | TDD normal, tests en `test/domain/**`        |
| Persistencia          | `src/storage/**`    | `Storage` inyectado y mockeado               |
| Componentes           | `src/components/**` | Testing Library, estados loading/error/vacío |
| API del exchange      | `src/api/**`        | fixtures/MSW (nunca la API real en tests)    |
| E2E                   | `e2e/**`            | solo humo, no forma parte del TDD            |

Fuera de TDD: render exacto del gráfico (canvas/SVG), estilos y disposición.

## Convenciones de código

- TypeScript estricto (`noUncheckedIndexedAccess` activo): los índices de array pueden ser `undefined`.
- Nombres en inglés para código y tests; el backlog/docs pueden ir en español.
- Fecha/hora en timestamps Unix en milisegundos (UTC).
- Los errores de dominio son clases con `this.name` (p. ej. `InvalidCandlesError`).

## Al terminar una tarea

```bash
pnpm test && pnpm typecheck && pnpm format:check   # los tres en verde
```

Actualizar `tests.md` (marcar los tests hechos) si la tarea añadió cobertura.
