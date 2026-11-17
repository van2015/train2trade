/**
 * Mutation testing (Stryker) — ver AGENTS.md (pnpm test:mutation).
 *
 * - `coverageAnalysis` lo fuerza el vitest-runner a `perTest`: por cada
 *   mutante solo corren los tests que ejercitan esa línea (clave para el coste).
 * - `checkers: ['typescript']` descarta mutantes que no compilan.
 * - `thresholds.break` es `null`: el run es **informativo** (ratchet no
 *   bloqueante); se endurece en la fase M4 a (score actual − 5).
 * - Alcance por defecto `src/domain`: `src/components` queda fuera a propósito
 *   (mutar JSX + mocks/jsdom tiene bajo señal y mucho ruido).
 */
export default {
  mutate: ['src/domain/**/*.ts'],
  // Con pnpm el glob por defecto (`@stryker-mutator/*`) se resuelve sobre las
  // dependencias aisladas de core y no ve estos dos paquetes: se declaran.
  appendPlugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  // NOTA (v10): la opción `ignoreMutations` ya NO existe (sustituida por `ignorers`/plugins).
  // Los mutantes equivalentes demostrados se aceptan como Supervivientes y se documentan en
  // docs/mutation-triage.md (coste: ~3 mutantes ≈ −0,1 % de score).
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  thresholds: {
    high: 80,
    low: 60,
    // Ratchet: piso = score actual (78,6 %) − 5 →73. Informativo: si un cambio
    // lo baja por debajo, `stryker run` sale con código1. Se sube al mejorar.
    break: 73,
  },
  concurrency: 4,
  // Los mutantes "static" (código que se ejecuta al cargar el módulo) suponen
  // ~7% de los mutantes pero ~58% del tiempo: se ignoran (recomendación de Stryker).
  ignoreStatic: true,
  timeoutFactor: 2,
  timeoutMS: 15_000,
  tempDirName: '.stryker-tmp',
  incremental: false,
}
