# Plan: regla "primera vez desde que…" (secuencia con ancla)

> **Estado: implementado (2026-11-15) — T1…T6 completados con TDD.**
> `pnpm test && pnpm typecheck && pnpm format:check` en verde (**1109 tests**, 79 archivos) y
> `pnpm build` compila sin errores; `proyectstate.md` y `tutorial-estrategias.md` actualizados.
> Decisiones cerradas con el usuario (§10): **ancla con `==`**, **nodo `first_since`**,
> **re-anclar en empates**. Pendiente: aplicar los mensajes de commit sugeridos por tarea
> (AGENTS.md §Git: el agente no hace commits).
>
> Objetivo: poder definir en el editor una confirmación de entrada **secuencial**, p. ej.
> _"primera vela que cierra por encima de la EMA(15) a partir del mínimo de 100 velas"_.
> Hoy el motor solo sabe evaluar **estado por vela** (¿se cumple ahora?), no **secuencias**
> (¿es la primera vez que se cumple desde que pasó X?).

## 1. Contexto — la estrategia objetivo

Frase original del usuario (decisión cerrada: _"Secuencia: tras tocar el mínimo"_).

| Trozo de la frase                                         | ¿Hoy? | Dónde / por qué                                                                                  |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------ |
| EMA de 15 periodos                                        | ✅    | `IndicatorSpec` `kind: 'ema'`, periodo 15                                                        |
| Mínimo de 100 periodos                                    | ✅    | `IndicatorSpec` `kind: 'lowestLow'`, periodo 100 (catálogo ampliado en la tarea anterior)        |
| "vela que **cierra** por encima"                          | ✅    | `condition` `>` con `close` y `ema15`, evaluada al cierre (§12B, sin look-ahead)                 |
| "**primera** vela"                                        | ⚠️    | Solo lo aporta la máquina de estados (`WaitingForSignal`): la primera _mientras no hay posición_ |
| "**empezando desde** el mínimo de 100 velas" (el ancla)   | ❌    | No hay memoria entre velas: `Rule.evaluate(context)` es una función pura por vela                |
| "es **igual a**" (para decir "esta vela marca el mínimo") | ❌    | `ConditionOp` solo admite `crosses_above`, `crosses_below`, `>`, `<`                             |

### Dos huecos concretos

1. **Sin ancla**: no existe "desde que se cumplió X". `low < min100` nunca es cierto (el mínimo
   incluye la vela actual ⇒ `min100 ≤ low`), `low > min100` es cierto casi siempre (lo contrario
   de lo que queremos) y no hay igualdad ni desfase para expresar _"esta vela está en el mínimo"_.
2. **Sin "primera vez"**: aunque el ancla existiera, no hay forma de decir _"y solo la primera vez
   que la condición se cumple a partir de ahí"_. Sin eso, tras salir de la operación la estrategia
   reentraría en cuanto `close > ema15` vuelva a ser cierto (cada vela sobre la EMA).

## 2. Alternativas descartadas (y por qué)

| Alternativa                                                     | Por qué se descarta                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latch con estado dentro de `Rule`** (`private armed = false`) | `Rule` vive en `Strategy` compartida por preview/editor/backtest/test-forward; el estado filtraría entre corridas, rompería determinismo (§12C) y el barrido con prefijos de `confirmationPoints` reutiliza el mismo árbol en muchos índices. |
| **Indicador derivado** (flag 0/1 "hay que entrar")              | Metería EMA+mínimo dentro de un indicador concreto: no reutilizable para otras reglas y los indicadores no deben conocer reglas (§9/§10: el indicador es componente de dominio reutilizable).                                                 |
| **Campo `since` opcional en `condition`**                       | Más simple en la UI, pero no es componible: no permite _"primera vez que (A y B) desde que C"_ ni anclar un grupo. El **nodo** es uniforme con `and`/`or`/`not`.                                                                              |
| **Desfase `hace N velas` por operando en esta iteración**       | Potente y genérico (`low < min100` con `min100` a 1 vela = _nuevo mínimo_), pero toca forma de `RuleSpec`, validación de cruces con desfases distintos y dos campos numéricos en la UI. **Queda como follow-up** (§9).                        |

## 3. Semántica propuesta

Nuevo nodo en el árbol de reglas:

```ts
{
  kind: 'first_since'
  since: RuleSpec
  then: RuleSpec
}
```

- **`since`** (el **ancla**): evento de partida.
- **`then`** (la **condición**): lo que se espera esperar.

> `first_since` es cierto en la vela actual **sii**:
>
> 1. `then` es cierto en la vela actual, **y**
> 2. existe una vela `k ≤ actual` en la que `since` es cierto (el ancla **más reciente**), **y**
> 3. no hay ninguna vela en `(k, actual)` en la que `then` sea cierto.

Es decir: **es la primera vez que `then` se cumple a partir del último `since`**. Si `since` es
cierto en la propia vela actual, el hueco `(k, actual)` está vacío ⇒ se cumple (condición 1 basta).

### Recorrido con la estrategia objetivo

`since = low == min100` · `then = close > ema15`

| Vela  | `low = min100` (ancla) | `close > ema15` | ¿Dispara? | Motivo                                      |
| ----- | ---------------------- | --------------- | --------- | ------------------------------------------- |
| 10    | ✅ (marca el mínimo)   | ❌              | ❌        | ancla nueva, `then` aún no cumple           |
| 11–14 | ❌                     | ❌              | ❌        | `then` falso ⇒ camino corto                 |
| 15    | ❌                     | ✅              | ✅        | primera `then` desde el ancla de la vela 10 |
| 16–30 | ❌                     | ✅              | ❌        | ya hubo una `then` entre ancla y ahora      |
| 40    | ✅ (vuelve al mínimo)  | ❌              | ❌        | **nuevo ancla**: el ciclo se rearmó         |
| 47    | ❌                     | ✅              | ✅        | primera `then` desde el ancla de la vela 40 |

### Propiedades (las tres invariantes del proyecto)

- **Estadoless / determinista**: el resultado depende solo del prefijo de velas visible. Nada que
  reiniciar entre corridas, nada que persistir, reproducible byte a byte (§12C).
- **Sin look-ahead**: el barrido solo mira hacia atrás (`at(back)` con `back ≥ 0`) y los contextos
  ya son prefijos en todos los consumidores (`tradingSession`, `confirmationPoints`,
  `TestForwardSessionView`).
- **Puro y sin React**: vive en `rules.ts`; backtest, replay, test-forward y preview usan el mismo
  código (§10/§14).

## 4. Decisiones de diseño

| Decisión                          | Elección                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dónde vive la memoria             | **En el propio historial**, no en el objeto: `FirstSince` recorre el contexto hacia atrás.                                                                                                                       |
| Forma del ancla en esta iteración | **Operador `==`** en las condiciones: `low == min100` = _"esta vela marca el mínimo de 100 velas"_. Exacto por construcción (`min100` **es** uno de los `low` de la ventana) y sin tocar la forma de `RuleSpec`. |
| Acceso al pasado                  | **`MarketContext.at(back)`**: vista derivada con la vela actual desplazada. Comparte velas/series (O(1)), inmutable y solo retrocede.                                                                            |
| Alias de operación en el pasado   | `entry`/`sl`/`tp` **no tienen histórico** ⇒ `null` en cualquier vista desplazada (mismo criterio que `back > 0` hoy).                                                                                            |
| Coste                             | Camino corto O(1) si `then` es falso (lo habitual); peor caso O(n) por evaluación ⇒ **O(n²)** por backtest, aceptable con `MAX_CANDLES = 1000` (mismo criterio que `confirmationPoints`, ya documentado).        |
| Composición                       | `first_since` es un nodo más: puede anidarse en `and`/`or`/`not` y sus dos ranuras aceptan cualquier nodo (incluidos grupos).                                                                                    |
| Persistencia                      | La unión `RuleSpec` **crece**; las specs guardadas siguen validando sin migración. `fingerprint`/`version` solo cambian si se usa el nodo nuevo.                                                                 |
| Observabilidad                    | `Rule.name = firstSince(low == min100, close > ema15)` ⇒ aparece en `Signal.name` y en `StrategyDecision.reason` (mismo canal que hoy).                                                                          |
| Preview / gráfico                 | **Sin cambios**: el preview dibuja indicadores y niveles, no reglas. (Marcar anclas en el gráfico = follow-up.)                                                                                                  |

## 5. Contratos propuestos

### T1 — `MarketContext.at(back)` (`src/domain/strategies/marketContext.ts`)

```ts
class MarketContext {
  private constructor(
    private readonly visibleCandles: readonly Candle[],
    private readonly series: Readonly<Record<string, readonly IndicatorValue[]>>,
    private readonly levelsValue: OperationLevels,
    /** Índice de la vela actual dentro de `visibleCandles` (len - 1 por defecto). */
    private readonly base: number,
  ) {}

  /** Contexto cuya vela actual es la de hace `back` velas (0 = este contexto). */
  at(back: number): MarketContext {
    if (!Number.isInteger(back) || back < 0) {
      throw new RangeError(`back debe ser un entero >= 0 (recibido: ${back})`)
    }
    if (back > this.base) {
      throw new MarketContextError('at() no puede retroceder más allá de la primera vela', back)
    }
    if (back === 0) return this
    return new MarketContext(this.visibleCandles, this.series, this.levelsValue, this.base - back)
  }
}
```

Cambios derivados (todos internos; el contrato público no cambia):

| Miembro           | Hoy                      | Con `base`                                                                             |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `current`         | última vela              | `visibleCandles[base]`                                                                 |
| `previous`        | `length - 2`             | `visibleCandles[base - 1]`                                                             |
| `length`          | `visibleCandles.length`  | `base + 1` (velas visibles _para esa vela actual_)                                     |
| `candles`         | array congelado          | `base === len - 1` → el mismo array (**compartido**, ver test `toBe`); si no → prefijo |
| `value(id, back)` | `index = len - 1 - back` | `index = base - back`; alias de operación → `null` si `base !== len - 1`               |
| `withLevels`      | nueva instancia          | **preserva `base`**                                                                    |
| `from`            | nueva instancia          | `base = candles.length - 1` (tras `validateCandles`, ⇒ `base ≥ 0`)                     |

### T2 — Operador `==` (`rules.ts` + `spec.ts` + `RuleEditor.tsx`)

```ts
// spec.ts
export type ConditionOp = 'crosses_above' | 'crosses_below' | '>' | '<' | '=='

// rules.ts — `Comparison` amplía su unión; `Equals` es su variante, igual que `Greater`/`Lower`
export class Comparison implements Rule {
  constructor(
    readonly a: SeriesRef,
    readonly b: SeriesRef,
    private readonly op: '>' | '<' | '==',
  ) {
    this.name = `${a} ${op} ${b}`
  }
  // evaluate: '==' → a === b (igualdad exacta, ver §8)
}

export class Equals extends Comparison {
  constructor(a: SeriesRef, b: SeriesRef) {
    super(a, b, '==')
  }
}
```

### T3 — Nodo `first_since` (`rules.ts` + `spec.ts`)

```ts
// spec.ts
export type RuleSpec =
  | { kind: 'condition'; op: ConditionOp; a: string; b: string }
  | { kind: 'and'; rules: RuleSpec[] }
  | { kind: 'or'; rules: RuleSpec[] }
  | { kind: 'not'; rule: RuleSpec }
  | { kind: 'first_since'; since: RuleSpec; then: RuleSpec }

// rules.ts
export class FirstSince implements Rule {
  readonly name: string

  constructor(
    readonly since: Rule,
    readonly then: Rule,
  ) {
    this.name = `firstSince(${since.name}, ${then.name})`
  }

  evaluate(context: MarketContext): boolean {
    if (!this.then.evaluate(context)) return false // camino corto (lo habitual)
    if (this.since.evaluate(context)) return true // el ancla es la vela actual

    let sawThen = false
    for (let back = 1; back < context.length; back += 1) {
      const past = context.at(back)
      if (this.since.evaluate(past)) return !sawThen // ancla más reciente
      if (this.then.evaluate(past)) sawThen = true // hubo una `then` antes del ancla
    }
    return false // nunca hubo ancla
  }
}
```

**Inventario de caminos que recorren `RuleSpec`** (hay que tocar los cuatro; dos **no** los
refuerza el compilador ⇒ obligatorios en los tests):

| Camino                                      | Archivo                        | Cambio                                            | ¿TS falla si se olvida?                             |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| `assertRuleSpec` (forma)                    | `spec.ts:152`                  | `case 'first_since':` recursa en `since` y `then` | No (tiene `default: throw`, pero solo valida forma) |
| `toRule` (construcción)                     | `spec.ts:199`                  | `case 'first_since': new FirstSince(...)`         | **Sí** (return type `Rule` no exhaustivo)           |
| `assertRuleOperations` (alias de operación) | `spec.ts:629`                  | recursar en `since` y `then`                      | **No** ⚠️ → test obligatorio                        |
| `RuleNode` (UI)                             | `components/RuleEditor.tsx:72` | rama nueva antes del fallback `and`/`or`          | **No** ⚠️ → se pintaría como grupo                  |

### T4 — UI (`src/components/RuleEditor.tsx`)

- **Alta**: botón `+ primera desde que` en la cabecera de los grupos (`and`/`or`), que añade
  `{ kind: 'first_since', since: defaultCondition(), then: defaultCondition() }`.
- **Nodo**: cabecera con los controles habituales (NOT / quitar) + etiqueta
  **"Primera vez desde que…"** y dos ranuras etiquetadas:
  - **"desde que"** → el ancla (`since`),
  - **"primera vez que"** → la condición (`then`).
- Cada ranura reutiliza `RuleNode` con `root` (ranura obligatoria: sin botón "quitar") y con
  controles NOT visibles; dentro admite condiciones, grupos, `not` y anidamiento.
- **Condiciones**: nueva opción `<option value="==">es igual a</option>`.

## 6. La estrategia objetivo en el editor

| Campo            | Valor                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Indicadores      | `ema15` = EMA 15 · `min100` = Mínimo (lowest low) 100                                                                     |
| Regla de entrada | **Primera vez desde que…** — desde que: `low` **es igual a** `min100` — primera vez que: `close` **es mayor que** `ema15` |
| Ejecución        | A mercado (rellena en la apertura de la siguiente vela: sin look-ahead)                                                   |

```jsonc
{
  "name": "rebound-ema15",
  "version": 1,
  "indicators": [
    { "alias": "ema15", "kind": "ema", "period": 15 },
    { "alias": "min100", "kind": "lowestLow", "period": 100 },
  ],
  "entry": {
    "execution": "market",
    "rule": {
      "kind": "first_since",
      "since": { "kind": "condition", "op": "==", "a": "low", "b": "min100" },
      "then": { "kind": "condition", "op": ">", "a": "close", "b": "ema15" },
    },
  },
}
```

Clases: `low`/`min100` → `price` ↔ `price` ✓ · `close`/`ema15` → `price` ↔ `price` ✓ · sin alias
de operación en `entry.rule` ✓ (el recorrido recursivo de `assertRuleOperations` lo garantiza).

## 7. Orden de implementación (TDD)

| T   | Qué                                 | Ficheros                                                                   | Tests                                                                                                                                                                                                                                            |
| --- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | `MarketContext.at(back)` + `base`   | `src/domain/strategies/marketContext.ts`                                   | `test/domain/strategies/marketContext.test.ts`: desplazamiento de `current`/`previous`/`value`, prefijo en `candles`, compartición de arrays, `withLevels` preserva `base`, `entry/sl/tp` → `null` desplazado, `RangeError`/`MarketContextError` |
| T2  | Operador `==`                       | `src/domain/strategies/rules.ts`, `spec.ts`, `components/RuleEditor.tsx`   | `rules.test.ts` (`Equals`, `name`), `spec.test.ts` (parse/build), `RuleEditor.test.tsx` (opción visible)                                                                                                                                         |
| T3  | Nodo `first_since` (dominio + spec) | `src/domain/strategies/rules.ts`, `spec.ts`                                | `rules.test.ts`: semántica (casos de la tabla §3, sin ancla, ancla actual, empates, anidamiento, `name`); `spec.test.ts`: forma, `buildRule`, **recursión de `assertRuleOperations` con alias de operación dentro del nodo**                     |
| T4  | UI del nodo                         | `src/components/RuleEditor.tsx`                                            | `RuleEditor.test.tsx`: alta, editar las dos ranuras, NOT, quitar hijo, borrado del nodo                                                                                                                                                          |
| T5  | E2E de la estrategia objetivo       | `test/domain/trading/runnerIntegration.test.ts` (o fichero nuevo)          | Entra **una sola vez** por ancla; no reentra siguiendo sobre la EMA; reentra tras un nuevo mínimo; anti look-ahead (mismo resultado con prefijos); decisión con `reason` legible                                                                 |
| T6  | Documentación                       | `docs/tutorial-estrategias.md` (sección de reglas), `docs/proyectstate.md` | —                                                                                                                                                                                                                                                |

`pnpm test && pnpm typecheck && pnpm format:check` en verde al final de cada tarea; commit sugerido
por tarea (AGENTS.md §Git: el agente no hace commits).

## 8. Riesgos, costes y precisiones

- **Igualdad exacta (`==`)**: sin tolerancia. En el ancla es exacto **por construcción**
  (`min100` devuelve el propio `low` de la ventana), pero `close == ema15` será casi nunca cierto.
  Documentar en el tutorial: _"igualdad exacta; úsala para extremos de precio (`low = min100`) y
  constantes"_.
- **Empates en el mínimo**: si varias velas seguidas tienen el mismo `low` mínimo, **cada una
  re-ancla**. Coherente con "empezando desde el mínimo" (el ciclo se rearmaría al volver al fondo);
  si se prefiere _"nuevo mínimo estricto"_, eso es el follow-up de desfases (`low < min100` con
  `min100` a 1 vela).
- **Coste**: O(1) en el caso normal (`then` falso), O(n) peor caso por evaluación y O(n²) por
  backtest con `MAX_CANDLES = 1000`. Medir en T3 (bench rápido como el de
  `strategy-preview-plan.md`); si dispara, cachear por identidad de contexto.
- **Anidamiento**: `first_since` dentro de `first_since` multiplica el barrido. Hoy `and`/`or`
  tampoco tienen cota de profundidad → sin límite en esta iteración; follow-up: cota en
  `assertRuleSpec`.
- **Rendimiento del preview**: sin cambios (el preview no evalúa reglas).

## 9. Fuera de alcance / follow-ups

1. **Desfase `hace N velas`** por condición (y/o por operando) para expresar _nuevo mínimo_
   estricto y "el cruce de hace 3 velas". Requiere decidir la forma (`back?: number` en la
   condición vs `aBack`/`bBack`) y la regla de desfases distintos en cruces.
2. **Marcadores en el gráfico** de los anclas/`first_since` disparados (observabilidad visual).
3. **Cota de profundidad** del árbol de reglas en `assertRuleSpec`.
4. `==` con tolerancia configurable (solo si aparece un caso real).

## 10. Decisiones cerradas con el usuario (2026-11-15)

| #   | Pregunta                                        | Decisión                                                                                                  |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | ¿Cómo se expresa el ancla?                      | **Operador `==`** (`low == min100`). El desfase _"hace N velas"_ queda como follow-up documentado (§9.1). |
| 2   | ¿Nodo `first_since` o `since` en la condición?  | **Nodo `first_since`**: componible, uniforme con `and`/`or`/`not`.                                        |
| 3   | ¿Re-anclar si el precio vuelve al mismo mínimo? | **Sí, re-anclar en empates** (consecuencia directa del `==`; sin coste añadido).                          |

Sin decisiones abiertas: se puede implementar por el orden de §7 (T1 → T6).
