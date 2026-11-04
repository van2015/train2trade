---
name: code-review
description: Revisa únicamente el código introducido en la rama actual (diff contra main) buscando alto acoplamiento, baja cohesión, code smells, violaciones de DRY, KISS y SOLID, y modelos de dominio anémicos. Usar cuando el usuario pide un code review, revisión de código o control de calidad de los cambios de la rama.
---

# Code Review de rama

## Alcance

Revisar **solo** el código introducido en la rama actual respecto a `main`, y **solo** ficheros de código dentro de `src/` y `test/`. Ignora cualquier otro fichero aunque aparezca en el diff (configs, raíz del repo, etc.). No reportes problemas preexistentes en líneas que el diff no toca. Si un archivo cambiado contiene problemas viejos no relacionados con el cambio, márcionalos aparte como "preexistentes, opcional" sin contarlos en el veredicto.

## Workflow

1. **Determinar el alcance del diff** (incluye commits y cambios sin commitear):

   ```sh
   BASE=$(git merge-base main HEAD 2>/dev/null || git rev-list --max-parents=0 HEAD)
   git diff --stat "$BASE"
   ```

   - Si `main` no existe localmente, prueba con `origin/main`.
   - Si el repo aún no tiene `main` (commit raíz), usa el commit raíz como base y revisa todos los ficheros fuente.
   - Obtén la diff completa de código fuente, restringida a `src/` y `test/`: `git diff "$BASE" -- 'src/**/*.ts' 'src/**/*.tsx' 'test/**/*.ts' 'test/**/*.tsx'`.

2. **Ignorar ruido**: `package-lock.json`, `dist/`, assets, formatos y configs triviales. Centra la revisión en el código fuente; los `.md` solo si contienen especificaciones que el código incumple.

3. **Lee el fichero completo** de cada cambio relevante (no solo la diff): acoplamiento y cohesión no se ven en líneas aisladas. Si hace falta, busca quién importa lo cambiado (`grep` de imports) para juzgar dependencias reales.

4. **Aplica la checklist** de abajo. Analiza solo los principios aplicables; no rellenes la lista para cumplir cada uno.

5. **Clasifica por severidad**:
   - 🔴 **Alto**: debe corregirse antes del merge (rotura de diseño, violación clara de SOLID/DRY con impacto).
   - 🟡 **Medio**: debe corregirse pronto (smell con coste de mantenimiento).
   - 🟢 **Bajo**: nit / sugerencia opcional.

   Sin ruido: si un principio no tiene hallazgos reales, dilo explícitamente en el resumen en vez de inventar hallazgos.

6. **Verifica**: ejecuta `npm test` y `npm run build`. Si fallan, es un hallazgo 🔴 (o indica que no se pudieron ejecutar).

7. **Emite el informe** con el formato de abajo. Solo si el usuario lo pide, aplica las correcciones propuestas.

## Checklist

### Acoplamiento (buscar alto acoplamiento)
- Módulos que conocen los internos de otros: imports cruzados entre capas, acceso a detalles de implementación.
- Dependencias directas de concreciones: `fetch`/DOM/lógica de red dentro de componentes de UI, acceso directo a almacenamiento desde la lógica de negocio.
- Estado global o variables mutables compartidas por muchos módulos.
- Shotgun surgery: un cambio de un concepto obliga a tocar muchos ficheros.
- Módulos que solo pueden testearse con todo el sistema montado (tests frágiles derivados de dependencias concretas).

### Baja cohesión
- Funciones o componentes que hacen varias cosas no relacionadas (recoger datos + transformar + presentar + validar).
- Ficheros "god" con múltiples responsabilidades mezcladas.
- Código que encaja mal con el propósito del módulo (utilidades sueltas dentro de componentes, por ejemplo).
- Funciones que solo se usan desde otro módulo distinto al suyo, o variables declaradas lejos de su único uso.

### Code smells
- Funciones/componentes largos (>30 líneas), anidamiento profundo (>3 niveles), alta complejidad cicломática (cadenas if/switch largas).
- Números y strings mágicos; uso de `any` o cast forzado en TypeScript.
- Duplicación evidente, código muerto, comentarios obsoletos o TODOs sin dueño.
- Listas largas de parámetros, primitive obsession (objetos planos como strings numéricos en vez de tipos).
- Errores tragados (`catch` vacío, promesas sin `await` ni manejo).

### DRY
- Lógica repetida dentro del diff o duplicada con código ya existente del repo.
- Copiar-pegar con pequeñas variaciones → proponer una función, hook o genérico común.

### KISS
- Abstracciones prematuras: interfaces, generics o hooks con un solo uso.
- Soluciones complejas donde basta lo simple; indirecciones innecesarias.
- Over-engineering: patrones (observer, factory, strategy) sin problema que los justifique.

### SOLID
- **S**: módulos con más de una razón para cambiar (responsabilidades mezcladas).
- **O**: cadenas if/switch sobre tipos que habrá que extender con cada nueva variante.
- **L**: implementaciones que incumplen el contrato de su tipo/interfaz.
- **I**: interfaces o props "gordas" que obligan a implementar o propagar parte que no se usa.
- **D**: módulos de alto nivel importando y usando detalles concretos en vez de una abstracción.

### Específico de React + TypeScript (este proyecto)
- Componentes muy grandes o hooks que hacen fetch + transformación + estado en uno.
- `useEffect` con efectos desordenados o dependencias mal declaradas.
- Lógica de negocio dentro de componentes que debería vivir en módulos testeables.
- Estado global donde bastaba estado local, o prop drilling profundo.

## Domain Modeling Principles

### Architectural preference

Prefer an object-oriented domain model in which domain objects encapsulate both state and behavior.

Do not default to procedural programming disguised as object-oriented programming through TypeScript interfaces, data structures and external services.

### Domain analysis

Before implementing a feature:

1. Identify the relevant domain concepts.
2. Identify entities, value objects and their relationships.
3. Identify the state and lifecycle of each entity.
4. Identify the invariants that must always hold.
5. Identify the operations that belong to each domain object.
6. Identify which objects are responsible for changing and validating their own state.
7. Identify collaborations between domain objects.

### Rich domain model

Domain entities should:

- Encapsulate their internal state.
- Expose meaningful domain operations rather than arbitrary setters.
- Protect their invariants.
- Control their own valid state transitions.
- Own behavior that is conceptually related to their state and responsibilities.

Avoid anemic domain models where entities are merely data containers and domain logic is implemented in external services or procedural functions.

### Design review

When reviewing a design, explicitly investigate:

- Domain logic operating on data belonging to another object.
- Services containing behavior that could belong to domain entities.
- Public setters allowing arbitrary state modifications.
- State transitions implemented outside the objects whose lifecycle they govern.
- Duplicated business rules across services.
- Objects that expose their internal representation instead of meaningful operations.

Do not assume that a design is good merely because it uses interfaces, types, dependency injection, pure functions or SOLID principles.

### Separation of concerns

Keep domain logic independent of React, UI components, persistence and infrastructure.

React state management must not dictate the domain model.

Use application services to coordinate use cases and domain objects, not to replace domain behavior.

### Design justification

Do not introduce classes merely to satisfy an object-oriented preference.

For each domain class, explain its responsibilities, invariants and behavior.

If a behavior is better represented by a pure function or a domain service, explain why it does not naturally belong to an individual domain object.

## Formato del informe

```markdown
# Code Review — `<rama>` vs `main`

**Alcance**: N ficheros cambiados, +A/−B líneas — <lista breve de ficheros>
**Tests**: ✅ `npm test` pasa / ❌ falla / ⚠️ no ejecutados

## 🔴 Altos
1. **[Principio]** `src/foo.ts:42` — descripción concreta del problema (cita la evidencia)
   - *Por qué importa*: impacto real en mantenimiento o corrección
   - *Sugerencia*: refactor concreto

## 🟡 Medios
…

## 🟢 Bajos / nits
…

## Preexistentes (opcional, fuera del alcance)
…

## Resumen
| Principio | Hallazgos |
|---|---|
| Acoplamiento | 0 / 1 / … |
| Cohesión | … |
| Code smells | … |
| DRY | … |
| KISS | … |
| SOLID | … |
| Domain modeling | … |

**Veredicto**: aprobar ✅ / aprobar con cambios 🟡 / requiere rework 🔴 — en una frase.
```

Cada hallazgo debe ser accionable: fichero, línea, evidencia y sugerencia. Un hallazgo vago ("mejorar la cohesión") no cuenta; si no puedes señalar dónde y por qué, no lo reportes.
