# Refactorización a Programación Orientada a Objetos

## Objetivo

Unificar el paradigma de programación bajo el enfoque **Orientado a Objetos (OOP)**, donde todo objeto tiene datos y comportamiento descritos mediante clases.

**Regla:** No mezclar paradigmas. Todo módulo debe ser una clase con estado interno y métodos.

---

## Archivos Analizados

| Archivo | Estado Actual | Necesita Refactorización |
|---------|---------------|--------------------------|
| `src/backtest/Backtest.ts` | Funcional/Procedimental | ✅ Sí |
| `src/backtest/Broker.ts` | Mixto (clase + función suelta) | ✅ Sí |
| `src/backtest/Strategy.ts` | Funcional/Procedimental | ✅ Sí |
| `src/backtest/Trade.ts` | Mixto (clase + función suelta) | ✅ Sí |
| `src/backtest/Metrics.ts` | Funcional/Procedimental | ✅ Sí |
| `src/backtest/Resample.ts` | Funcional/Procedimental | ✅ Sí |
| `src/services/AssetService.ts` | OOP | ❌ No |
| `src/services/IndicatorService.ts` | Funcional/Procedimental | ✅ Sí |
| `src/services/ValidationService.ts` | Funcional/Procedimental | ✅ Sí |
| `src/services/PriceRetrievalStrategy.ts` | OOP | ❌ No |
| `src/utils/Interval.ts` | OOP | ❌ No |
| `src/utils/timeLabel.ts` | Funcional/Procedimental | ✅ Sí |

---

## Detalle por Archivo

### 1. `src/backtest/Backtest.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `toTime()` (línea 36) — conversión de fechas
- `entryFillReference()` (línea 40) — cálculo de precio de entrada
- `runBacktest()` (línea 55) — orquestador principal del backtest

**Acción propuesta:** Crear una clase `BacktestEngine` que encapsule:
- Estado: datos del backtest (precios, configuración)
- Métodos: `run()`, `toTime()`, `entryFillReference()`
- Factory method estático para instanciación

---

### 2. `src/backtest/Broker.ts`

**Estado:** Mixto

**Problema:** Ya tiene clase `Broker` (línea 14), pero contiene función suelta `roundToStep()` (línea 8)

**Acción propuesta:** Mover `roundToStep` como método privado estático dentro de la clase `Broker`

---

### 3. `src/backtest/Strategy.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `registerStrategy()`, `getStrategy()`, `listStrategies()`, `clearStrategies()`
- `normalizeStrategyParams()`, `resolveStrategy()`, `createContext()`
- `isValidTradeSpec()`, `validTradeSpecs()`
- Helpers: `isFiniteNumber()`, `isValidRule()`
- Estado en módulo: `registry` (línea 13)

**Acción propuesta:** Crear clase `StrategyManager` que encapsule:
- Estado interno: registry de estrategias
- Métodos: todas las funciones de registro/consulta
- Validaciones como métodos privados

---

### 4. `src/backtest/Trade.ts`

**Estado:** Mixto

**Problema:** Ya tiene clase `Trade` (línea 7), pero contiene función suelta `directionFactor()` (línea 3)

**Acción propuesta:** Mover `directionFactor` como método privado estático dentro de la clase `Trade`

---

### 5. `src/backtest/Metrics.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `computeMetrics()` (línea 8)

**Acción propuesta:** Crear clase `MetricsCalculator` con:
- Factory method estático `compute()` o
- Métodos de cálculo como parte de una clase `PerformanceMetrics`

---

### 6. `src/backtest/Resample.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `floorToBoundary()` (línea 5) — alineación temporal
- `formatDate()` (línea 10) — formateo de fechas
- `resample()` (línea 14) — función principal

**Acción propuesta:** Crear clase `DataResampler` que encapsule:
- Estado: datos a re muestrear
- Métodos: `resample()`, `floorToBoundary()`, `formatDate()`

---

### 7. `src/services/AssetService.ts`

**Estado:** OOP ✅ — No requiere cambios

---

### 8. `src/services/IndicatorService.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `toTime()`, `sma()`, `ema()`, `bollinger()`, `rsiValue()`, `rsi()`, `macd()`
- `toPlotPoints()`, `getDefinition()`, `normalizeParams()`
- `newInstanceKey()`, `createIndicatorInstance()`
- `getIndicatorGroups()`, `compute()`, `computeSeries()`, `maxLookback()`

**Acción propuesta:** Dividir en clases coherentes:
- `IndicatorCalculator` — cálculos técnicos (sma, ema, bollinger, rsi, macd)
- `IndicatorDefinitionRegistry` — gestión de definiciones
- `IndicatorEngine` — compute y computeSeries

---

### 9. `src/services/ValidationService.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `checkDuplicates()` (línea 21)
- `validateCandle()` (línea 35)
- `validateAndParse()` (línea 69)
- `parseCSV()` (línea 171)
- `parseJSON()` (línea 230)

**Acción propuesta:** Crear clase `DataValidator` con:
- Método público: `validateAndParse()`
- Métodos privados: `checkDuplicates()`, `validateCandle()`, `parseCSV()`, `parseJSON()`

---

### 10. `src/services/PriceRetrievalStrategy.ts`

**Estado:** OOP ✅ — No requiere cambios

---

### 11. `src/utils/Interval.ts`

**Estado:** OOP ✅ — No requiere cambios

---

### 12. `src/utils/timeLabel.ts`

**Estado:** Puramente funcional/procedimental

**Funciones sueltas a refactorizar:**
- `formatOptionsFor()` (línea 10)
- `createTimeLabelFormatter()` (línea 24)

**Acción propuesta:** Crear clase `TimeLabelFormatter` con:
- Constructor/factory method
- Métodos de formateo

---

## Priorización Sugerida

### Alta prioridad (Lógica de negocio central)
1. `Backtest.ts` — componente central
2. `Strategy.ts` — registro y gestión de estrategias
3. `Metrics.ts` — cálculos de rendimiento
4. `Resample.ts` — procesamiento de datos

### Media prioridad (Capa de servicios)
5. `IndicatorService.ts` — indicadores técnicos
6. `ValidationService.ts` — validación de datos

### Baja prioridad (Problemas menores)
7. `Broker.ts` — solo una función a mover
8. `Trade.ts` — solo una función a mover
9. `timeLabel.ts` — encapsular utilidad

---

## Criterios de Refactorización

Para cada archivo:
1. **Identificar estado** — ¿qué datos sonmutable y cómo se comparten?
2. **Agrupar funciones** — ¿qué funciones operan sobre los mismos datos?
3. **Definir responsabilidades** — ¿qué hace la clase? ¿qué NO hace?
4. **Preservar API pública** — mantener la misma interfaz de uso
5. **Tests** — verificar que los tests existentes siguen pasando
