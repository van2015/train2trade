# Refactors no realizados

Registro de refactorizaciones identificadas durante la revisión del dominio (`src/domain/candles`, 2026-11-04) y en la sesión de refactor del 2026-11-11, que se decidieron **no hacer** para evitar refactor especulativo. Revisar este documento cuando se cumplan los disparadores.

## Refactors pendientes

| #     | Refactor                                                                                                      | Por qué no ahora                                                                                                                                                                                                                                                                                              | Disparador para hacerlo                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~E~~ | ~~Extraer la extracción de campos en `normalizeCandles`~~                                                     | **Resuelto** por `Candle.from` (ver abajo)                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                      |
| ~~F~~ | ~~Mover `MAX_CANDLES` y `candleLimitForRange` de `timeframe.ts` a una capa de fetch~~                         | **Resuelto** el 2026-11-08: viven en `src/api/candleRequest.ts`, con sus tests en `test/api/` (ver abajo)                                                                                                                                                                                                     | —                                                                                                                                                                                                                      |
| G     | Partir `Candle`: extraer la geometría (posición/niveles) a `candleGeometry.ts` con tipo estructural `Ohlc`    | La clase es cohesiva (todo es "una vela") y sus métodos son triviales (1-5 líneas); ningún consumidor trabaja con algo que no sea `Candle`, así que las funciones libres solo añadirían indirection. La otra mitad (borrar los 6 `closes*/opens*`) se descartó: se conservan como API previsto para Fase 2/3. | 1) Aparece un segundo consumidor que no pueda ser un `Candle` (p. ej. dibujar OHLC crudo antes de `Candle.from`); 2) la geometría se complica (patrones de velas, Fibonacci); 3) `Candle` vuelve a superar ~250 líneas |
| H     | Mover `Candle.aggregate` a `aggregate.ts` (la fusión OHLCV vive en el VO y el agrupamiento en `aggregate.ts`) | No bloquea nada; `Candle.aggregate` es estable y testeado, y moverlo solo cambia dónde vive la fusión sin cambio de comportamiento.                                                                                                                                                                           | Retocar la agregación (p. ej. agregación desde menor granularidad, pendiente en `proyectstate.md`) o si `Candle` crece                                                                                                 |

## Contexto de la revisión

Refactors de esa ronda que **sí** se realizaron (ver commits `6c8cbfb` y `1f04b6b`):

- `Timeframe` como value object internado (absorbió `SUPPORTED_TIMEFRAMES`, `isSupportedTimeframe`, `resolveTimeframe`, `timeframeToMs`).
- `aggregateCandles` pasa a recibir `Timeframe` en vez de `timeframeMs: number`.
- Agregación en un solo paso (sin `group[0]!` ni arrays intermedios).
- `InvalidCandlesError` formatea su mensaje desde el valor crudo, consistente con `InvalidTimeframeError`.
- Test tautológico de `Object.keys` eliminado de `normalize.test.ts`.
- **E (resuelto):** `Candle` es ahora un value object (`src/domain/candles/candle.ts`) y `Candle.from` absorbe el parseo y la validación de los 6 campos; `normalizeCandles` solo deduplica y ordena.
- **F (resuelto):** `MAX_CANDLES` y `candleLimitForRange` se movieron de `src/domain/candles/timeframe.ts` a `src/api/candleRequest.ts` al implementar la capa `src/api/**` (Binance). Sus tests viajaron de `test/domain/candles/timeframe.test.ts` a `test/api/candleRequest.test.ts`.

## Regla

Antes de implementar un refactor de esta lista: comprobar que el disparador se ha cumplido y que existe cobertura de tests que lo respalde (TDD: el test pasa antes y después del refactor).
