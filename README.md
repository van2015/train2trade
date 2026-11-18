# train2trade

Laboratorio de trading de criptomonedas en el navegador: no es solo un backtester con un editor de
estrategias y un visor de gráficos, sino un entorno para recorrer el ciclo completo de
experimentación:

1. Obtener y organizar datos históricos de mercado.
2. Analizar gráficamente los activos mediante indicadores y herramientas de análisis técnico.
3. Diseñar estrategias de trading.
4. Ejecutar backtests sobre periodos históricos.
5. Analizar los resultados y modificar las estrategias.
6. Reproducir el mercado histórico como si estuviera sucediendo en tiempo real.
7. Evaluar la estrategia sin conocer los datos futuros.
8. Comparar experimentos y evaluar su robustez.

React + TypeScript (Vite), toda la lógica en el navegador, datos de precios de una API pública de
exchange (Binance) y persistencia local: sin backend ni cuentas.

## Dirección del producto (decidida)

El producto se puede entender de dos formas:

- **Enfoque A — Strategy-centric**: la estrategia es el centro. El usuario crea una estrategia,
  configura sus indicadores y reglas, ejecuta backtests y analiza resultados; el gráfico es una
  herramienta de análisis y visualización.
  ([EA Studio — Expert Advisor Studio](https://forexsb.com/forum/topic/8348/added-a-dark-theme-in-ea-studio/))
- **Enfoque B — Market-centric**: el mercado y el gráfico son el centro. El usuario estudia un
  activo, analiza sus gráficos, crea estrategias a partir de ese análisis y experimenta con ellas.
  ([Quantower Trading Platform. Detailed Overview — Medium](https://quantower.medium.com/quantower-trading-platform-detailed-overview-9588203fe666))

**Decisión: empezar por el enfoque A** para construir el núcleo de estrategias, ejecución y
experimentación —el que proporciona mayor valor técnico y el más difícil de sustituir después— e
incorporar después la experiencia de análisis Market-centric sobre ese núcleo, sin permitir que las
decisiones de interfaz condicionen el diseño del dominio.

La arquitectura encaja con un desarrollo TDD: empezar definiendo mediante tests el comportamiento de
Strategy, TradingEngine, Broker y MarketReplayEngine, y dejar que sus contratos emergan de los casos
de uso.

## Comandos

```bash
pnpm install       # instalar dependencias
pnpm dev           # servidor de desarrollo (Vite)
pnpm test          # Vitest en modo run (CI)
pnpm typecheck     # tsc --noEmit
pnpm format        # Prettier: formatear todo el repo
pnpm build         # typecheck + build de producción
```

Convención completa para agentes (imports, gates al terminar una tarea, git): [`AGENTS.md`](AGENTS.md).

## Documentación

| Documento                                                            | Contenido                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`docs/architecture.md`](docs/architecture.md)                       | Requisitos y diseño (§1–§14): subsistemas, decisiones de diseño, roadmap |
| [`docs/proyectstate.md`](docs/proyectstate.md)                       | Fuente de estado: qué está implementado y qué queda pendiente            |
| [`docs/domain-diagram.md`](docs/domain-diagram.md)                   | Mapa vivo del código: paquetes, clases, errores y flujos (Mermaid)       |
| [`docs/tutorial-estrategias.md`](docs/tutorial-estrategias.md)       | Guía de uso del editor de estrategias                                    |
| `docs/*-plan.md`                                                     | Planes de las fases y features (decisiones cerradas y tareas TDD)        |
| [`docs/mutation-triage.md`](docs/mutation-triage.md)                 | Registro de triage de mutation testing (Stryker)                         |
| [`docs/refactors-no-realizados.md`](docs/refactors-no-realizados.md) | Refactors aplazados y sus disparadores                                   |
