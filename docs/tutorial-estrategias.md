# Tutorial: crear y editar estrategias

> Guía de uso del formulario de estrategias (sidebar → sección **Estrategias**).
> Contexto y decisiones de diseño: [`estrategias-testforward-plan.md`](./estrategias-testforward-plan.md);
> estado del proyecto: [`proyectstate.md`](./proyectstate.md).

## 1. Dónde está y flujo general

**Sidebar → sección "Estrategias"** (la tercera del acordeón):

- **"Nueva estrategia"** → abre el editor con una _plantilla_ precargada (cruce SMA(10)/SMA(30),
  entrada a mercado, salida por cruce).
- **"Editar"** (botón de cada fila) → abre el editor con esa estrategia ya cargada.
- **"Borrar"** → elimina la entrada (los experimentos guardados no se tocan).
- **Cancelar / Deshacer / Guardar** → abajo del editor.

Al **Guardar**, la estrategia aparece en la lista (`nombre@versión` + huella) y en el **selector
"Estrategia" de la sección Experimentos**, del que cuelgan los 4 paneles (Backtest, Test-Forward,
Optimización, Replay). Es decir: guardas una vez y todos los experimentos la usan.

---

## 2. Cinco reglas de oro (léelas antes de tocar nada)

1. **No existen los precios absolutos.** Nunca escribes "130" como precio: todo precio (entrada, TP,
   SL, triggers) se expresa con **indicadores y relaciones entre ellos**. Los números solo entran
   como **indicadores constantes** (alias + valor, p. ej. `umbral30 = 30`).
2. **Tres clases de series**, que no se mezclan a la ligera:
   - **precio**: SMA/EMA, el mínimo de las últimas velas (Mínimo, _lowest low_) y las series de la
     vela `close`, `open`, `high`, `low`
   - **oscilador**: RSI
   - **constante**: lo que declares con tipo "Constante"

   En una **condición**: ambos lados de la misma clase, o **constante con cualquiera**
   (`rsi > umbral30` ✓, `close > rsi14` ✗). En una **expresión de precio**: solo
   `price`/`constante` (+ alias de operación); **nunca osciladores** (`rsi + sma` ✗).

3. **Alias de operación** (`entry`, `sl`, `tp`): son series "de la posición actual". Disponibilidad
   según contexto:

   | Dónde                      | `entry` | `sl` | `tp` |
   | -------------------------- | ------- | ---- | ---- |
   | Regla de entrada           | ✗       | ✗    | ✗    |
   | Regla de salida            | ✓       | ✓    | ✓    |
   | Veto                       | ✗       | ✗    | ✗    |
   | Precio de entrada (límite) | ✗       | ✗    | ✗    |
   | Precio de TP / SL          | ✓       | ✗    | ✗    |
   | Trigger                    | ✓       | ✓    | ✓    |

   (sin posición todavía → la entrada no puede verse a sí misma; el SL no puede referenciar su
   propio nivel, etc.)

4. **Alias = identificador único** que no puede ser un reservado (`close`, `open`, `high`, `low`,
   `entry`, `sl`, `tp`) ni repetirse. **Ojo: si renombras un indicador, las reglas que lo usaban
   quedan apuntando al alias viejo** → guarda y te avisará. Renombra antes de usarlo en reglas, o
   no renombres.
5. **Prioridad al evaluar** (mismo candle): `veto` → `stop loss` → `take profit` → `reglas`
   (entrada con posición cerrada / salida con posición abierta) → `triggers`.

---

## 3. Bloque a bloque

### 3.1 Nombre

Texto libre (no vacío). La versión **no** se edita: la asigna el panel al guardar.

### 3.2 Indicadores (tres grupos)

| Grupo                                      | Tipos              | Parámetro                | Botón de alta                              |
| ------------------------------------------ | ------------------ | ------------------------ | ------------------------------------------ |
| **Indicadores de precio (SMA/EMA/Mínimo)** | SMA / EMA / Mínimo | Periodo (entero ≥ 1)     | "Añadir indicador de precio" (crea SMA 20) |
| **Osciladores (RSI)**                      | RSI                | Periodo                  | "Añadir oscilador" (crea RSI 14)           |
| **Constantes**                             | Constante          | **Valor** (número libre) | "Añadir constante" (crea valor 30)         |

Cada fila: **Alias** (el nombre con el que lo referenciarás en reglas y precios), **Tipo**
(cambiarlo conmuta el parámetro: SMA→Constante pasa a valor 30; Constante→RSI pasa a periodo 14; el
Mínimo, como SMA/EMA/RSI, lleva periodo) y el parámetro. "✕" quita la fila.

### 3.3 Entrada

1. **Ejecución**: `A mercado` (la orden va a mercado y rellena a la apertura de la siguiente vela)
   o `Límite` (si eliges límite aparece **"Precio de entrada"**, ver §5).
2. **Regla de entrada** (árbol, ver §4): la condición que dispara la entrada. En el test-forward
   **esta regla es la "confirmación"**: el sistema se pausa y tú decides tomar/descartar.
3. Sin posición → esta única regla puede entrar; no hace falta indicar más.

### 3.4 Take profit / Stop loss

- Dos casillas **desactivadas por defecto** (si no la activas, la estrategia _no declara_ ese
  nivel → ni salidas automáticas ni controles en la sesión de test-forward).
- Al activar cada uno aparece:
  - **Precio** = expresión (§5). Para el TP/SL puedes usar el alias `entry` (tu precio de relleno)
    además de indicadores.
  - **Ejecución**: `A mercado` / `Límite`.
- Se evalúan **solos** en cada vela: SL si `low <= nivel`, TP si `high >= nivel` (SL primero).
- **Aviso en vivo** (no bloquea): si el TP no queda por encima del SL o del precio de entrada,
  verás un aviso naranja _"…se dispararía al instante"_.

### 3.5 Triggers

Disparadores por **toque de precio** que ejecutan una acción sin que haya regla: compra
(`low <= precio`) o venta (`high >= precio`), según la acción:

| Acción           | Sentido | Fracción               |
| ---------------- | ------- | ---------------------- |
| Entrar           | compra  | —                      |
| Añadir posición  | compra  | **obligatoria** (0, 1] |
| Reducir posición | venta   | **obligatoria** (0, 1] |
| Salir            | venta   | —                      |

Fila: expresión de precio (§5, aquí sí están `entry`/`sl`/`tp`) + acción + ejecución + (fracción si
aplica) + ✕. **"Añadir trigger"** crea uno por defecto: precio `close`, acción _Salir_, a mercado.

### 3.6 Salida y veto

- **Salida por regla** (casilla): árbol como el de entrada, pero con posición **abierta**; aquí sí
  puedes usar `entry`/`sl`/`tp`. Es la "salida por señal": en el test-forward, cuando dispara, la
  sesión pausa y tú decides _Cerrar/Mantener_.
- **Veto (invalidación)** (casilla): si dispara, **bloquea entradas** (y retira una orden de
  entrada pendiente). Nunca bloquea salidas ni TP/SL. Útil para "solo entrar si el mercado está en
  calma". Sin alias de operación.

---

## 4. El editor de reglas (árbol) en detalle

Una condición se ve así:

```
[NOT]  [operador ▾]  [operando a ▾] [+c]  [operando b ▾] [+c]   [quitar]
```

- **Operadores**: `cruza al alza`, `cruza a la baja`, `es mayor que`, `es menor que`, `es igual a`
  (igualdad **exacta**, pensada para extremos de precio: `low = min100` = "esta vela marca el
  mínimo"; no sirve para comparar cosas casi iguales).
- **`a`** ofrece _todos_ los alias del contexto; **`b`** solo ofrece **aliados compatibles**
  (misma clase que `a` o constante, y nunca el propio `a`). Si cambias `a` y `b` queda
  incompatible, se reajusta solo.
- **`+c`** (atajo): crea al vuelo una constante nueva (`c1`, `c2`… valor 30) y la asigna al
  operandó. Cómodo para umbrales desechables; si quieres un nombre bonito, usa mejor el bloque
  _Constantes_ antes.
- **`NOT`**: envuelve/desenvuelve ese nodo (otra vez el botón para quitarlo).
- **Grupos**: dentro de un grupo hay botones **`+ condición`**, **`+ grupo`** y **`+ primera desde
que`** (sub-AND/OR o un nodo de secuencia, anidable sin límite) y la cabecera indica `Y (todas)` u
  `O (alguna)`. Cada hijo tiene su botón `quitar` (el nodo raíz no).
- Todo se puede anidar: `(A y B) o (no C)`.

### Nodo "primera vez desde que" (secuencia con ancla)

Desde una condición, el botón **`+ primera desde que`** la envuelve en un nodo de secuencia; desde un
grupo, añade uno nuevo. Se ve así:

```
[NOT]  Primera vez desde que…
  desde que (ancla)          ← lo que marca el punto de partida
  se cumple (primera vez)    ← lo que se espera a partir de ahí
```

- La regla solo es cierta en la **primera** vela en que la condición inferior se cumple **desde la
  última vez** que se cumplió el ancla. Después ya no vuelve a ser cierta hasta que haya un ancla
  nuevo: **una sola confirmación por ancla**, aunque el precio siga cumpliendo la condición.
- Ambas ranuras aceptan cualquier nodo (condición, grupo, `NOT`) y son obligatorias: tienen `NOT`
  pero no `quitar`.
- **Ejemplo** (entrada): indicadores `ema15` (EMA 15) y `min100` (Mínimo 100), y la regla
  _desde que_ `low` **es igual a** `min100` → _se cumple_ `close` **es mayor que** `ema15`:
  entras en la primera vela que cierra sobre la EMA(15) a partir del mínimo de 100 velas.
- La memoria está en el **histórico**, no en un estado oculto: la misma regla se evalúa igual en
  backtest, replay, test-forward y preview, y nunca mira velas futuras.

**Reglas prácticas:**

- `cruza al alza` necesita _cruces_ (momentos), `es mayor que` es estado continuo. Para "entra
  cuando el RSI cruza por debajo de 30" usa `rsi < umbral30` (estado); para "entra en el cruce de
  medias" usa `cruza al alza`.

---

## 5. El editor de expresiones de precio (suma de productos)

Se usa en: Precio de entrada (si límite), TP, SL y triggers. Forma plana: **términos con signo,
cada término un producto de series**:

```
[+] fast  [× factor] [✕ término]        [−]  two  ×  atr14        [+ término]
```

- **Primer término** sin selector de signo; los demás tienen signo `+`/`−`.
- Cada término: 1..N factores separados por `×`. **`× factor`** añade otro factor al producto;
  **`✕`** quita un factor (mínimo 1).
- **`+ término`** añade un término (por defecto con `close`); **`✕ término`** lo quita (mínimo 1).
- El orden se evalúa de izquierda a derecha: `a + b × c` = `a + (b × c)`.
- **No representable**: si la expresión cargada tiene divisiones o sumas anidadas dentro de
  productos (p. ej. `(a+b)×c`), verás el aviso _"Expresión no editable en el formulario"_ y se
  conserva el valor original sin controles.
- Opciones de cada selector: solo series de **precio/constante** del contexto + alias de operación
  permitidos (osciladores nunca aparecen aquí).

---

## 6. Guardar, deshacer, errores y versiones

- **Guardar** valida dos veces (forma + semántica: alias registrados, clases, contextos de
  operación). Si algo falla, aparece el **error en rojo dentro del formulario, no se guarda nada y
  el editor sigue abierto** para corregir.
- **Sin cambios → no se crea versión.** Si editas y guardas tal cual, la entrada no cambia.
- **Con cambios → versión nueva automática** (`max + 1` de ese nombre) y **la versión anterior se
  conserva** en la lista. Así todo experimento guardado sigue apuntando a una definición exacta.
- **Deshacer**: paso a paso (cada cambio de campo cuenta; hasta ~50 pasos). Empieza deshabilitado.
- **Cancelar** descarta todo el borrador.
- El aviso de niveles invertidos **solo avisa**: no impide guardar.

---

## 7. Ejemplo completo: estrategia RSI de sobreventa

**Objetivo**: entrar cuando el RSI(14) baja de 30, salir cuando supera 70, a mercado.

1. **Estrategias → "Nueva estrategia"** (llega la plantilla sma-cross).
2. **Nombre**: `rsi-sobreventa`.
3. **Indicadores**:
   - Fila 1: Tipo → `RSI`, Periodo → `14`, Alias → `rsi`.
   - Fila 2 (`slow`): **✕ quitar** (no la necesitamos).
   - **"Añadir constante"** → Alias `umbral30`, Valor `30`.
   - **"Añadir constante"** → Alias `sobrecompra`, Valor `70`.
4. **Entrada — regla** (aunque el borrador aún apunte a `fast`/`slow`, se arregla ahora):
   - Operador → `es menor que`
   - Operando a → `rsi`
   - Operando b → `umbral30` (solo verás aliados: osciladores y constantes)
   - Ejecución → `A mercado`.
5. **Salida por regla** (viene activada de la plantilla):
   - Operador → `es mayor que`, a → `rsi`, b → `sobrecompra`.
6. **TP/SL**: déjalos sin activar (las salidas las manda la regla).
7. **Guardar** → aparece `rsi-sobreventa@1`. Ve a **Experimentos**, elige la estrategia en el
   selector y ejecuta un backtest.

> Nota: hasta que todas las referencias sean coherentes (no queden alias viejos en las reglas),
> **Guardar** te devolverá _"el alias X no está registrado"_ — es el validador trabajando, no un
> bug.

**Variante con TP/SL**: activa _Take profit_, pon de precio `fast` (o cualquier serie) y guarda; en
la sesión de test-forward verás el control "Take profit: … (manual/Auto/Desactivado)" para
manipularlo en caliente.

---

## 8. Errores frecuentes

| Mensaje / aviso                                     | Causa                                                         | Solución                                      |
| --------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `el alias "X" no está registrado`                   | Renombraste/borraste un indicador usado en una regla o precio | Re-sincroniza la regla o reintroduce el alias |
| `no se pueden comparar series de clase "…" con "…"` | Condición tipo `close > rsi14`                                | Usa una constante o compara misma clase       |
| `los osciladores no forman precios`                 | Precio de entrada/TP/SL/trigger con RSI                       | Solo `price`/`constante`/alias de operación   |
| `el name no puede estar vacío`                      | Guardar sin nombre                                            | Escribe un nombre                             |
| `la señal "…" requiere una fraction en (0, 1]`      | Fracción 0, >1 o no numérica en Añadir/Reducir                | Valor en (0, 1] (p. ej. 0.5)                  |
| `… no admite fraction`                              | Pusiste fracción en Entrar/Salir                              | Quita el campo (la UI ya no lo muestra)       |
| Aviso naranja de niveles                            | TP ≤ SL o TP ≤ precio de entrada                              | Revisa las expresiones (solo avisa)           |
| El selector no muestra tu estrategia                | No le diste a Guardar, o guardaste sin cambios                | Guarda con cambios o revisa la lista          |

---

## 9. Después de guardar

- **Selector en Experimentos**: cambia la estrategia ahí y los 4 paneles (Backtest, Test-Forward,
  Optimización, Replay) pasan a usarla; el panel muestra siempre `Estrategia: nombre@versión`.
- **Optimización** genera rangos a partir de los **periodos** de esta estrategia (las constantes no
  se tocan).
- **Test-forward**: tu regla de entrada son los puntos de confirmación donde tú decides
  _Tomar/Descartar_; tu regla de salida los puntos de _Cerrar/Mantener_; TP/SL y triggers corren
  solos.
- **Historial**: cada experimento registra `nombre@versión` + huella; si editas la estrategia
  (versión nueva), el historial seguirá distinguiendo qué versión produjo qué resultado.
