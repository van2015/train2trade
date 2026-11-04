# Refactors no realizados

Registro de refactorizaciones identificadas durante la revisión del dominio (`src/domain/candles`, 2026-11-04) que se decidieron **no hacer ahora** para evitar refactor especulativo. Revisar este documento cuando se cumplan los disparadores.

## Refactors pendientes

| #     | Refactor                                                                                                                       | Por qué no ahora                                                                                           | Disparador para hacerlo                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ~~E~~ | ~~Extraer la extracción de campos en `normalizeCandles`~~                                                                      | **Resuelto** por `Candle.from` (ver abajo)                                                                 | —                                                                             |
| F     | Mover `MAX_CANDLES` y `candleLimitForRange` de `timeframe.ts` a una capa de fetch (`src/api/` o `src/domain/candles/fetch.ts`) | Son asunto de _solicitud de velas_, no del timeframe, pero todavía no existe la capa de API donde vivirían | Cuando se implemente la historia #1 (capa `src/api/**` que llama al exchange) |

## Contexto de la revisión

Refactors de esa ronda que **sí** se realizaron (ver commits `6c8cbfb` y `1f04b6b`):

- `Timeframe` como value object internado (absorbió `SUPPORTED_TIMEFRAMES`, `isSupportedTimeframe`, `resolveTimeframe`, `timeframeToMs`).
- `aggregateCandles` pasa a recibir `Timeframe` en vez de `timeframeMs: number`.
- Agregación en un solo paso (sin `group[0]!` ni arrays intermedios).
- `InvalidCandlesError` formatea su mensaje desde el valor crudo, consistente con `InvalidTimeframeError`.
- Test tautológico de `Object.keys` eliminado de `normalize.test.ts`.
- **E (resuelto):** `Candle` es ahora un value object (`src/domain/candles/candle.ts`) y `Candle.from` absorbe el parseo y la validación de los 6 campos; `normalizeCandles` solo deduplica y ordena.

## Regla

Antes de implementar un refactor de esta lista: comprobar que el disparador se ha cumplido y que existe cobertura de tests que lo respalde (TDD: el test pasa antes y después del refactor).
