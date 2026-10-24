## Story
Como trader, quiero que la apertura de la posición pueda ser a límite, con un precio límite definido por un indicador, para entrar solo a un precio concreto.

## Acceptance criteria
- [ ] Dado que estoy definiendo la apertura de una estrategia, cuando elijo "a límite" y un indicador con sus parámetros como precio límite, entonces el resumen muestra la apertura a límite con ese indicador, y la estrategia queda lista para guardar si lo demás está completo.
- [ ] Dado que he elegido "a límite" y no he elegido indicador de precio límite, cuando intento terminar la definición, entonces la estrategia no queda lista para guardar y veo qué falta.
- [ ] Dado que elijo "a mercado", cuando reviso la apertura, entonces no se pide ningún indicador de precio límite y el resumen muestra la apertura a mercado como hasta ahora.

## Plan
- Añadir al borrador de la apertura el tipo de orden (mercado o límite) y, solo si es límite, el indicador de precio límite con sus parámetros.
- Validar el indicador de precio límite únicamente cuando el tipo es límite, sin cambiar la validación actual de la apertura a mercado.
- Reutilizar el catálogo de condiciones (cierre, apertura, máximo, mínimo e indicadores técnicos) como fuente del precio límite.
- Añadir al bloque de apertura un selector mercado/límite que, si es límite, muestra el selector de indicador y sus parámetros.
- Mostrar el tipo y el indicador de precio límite en el resumen; cubrir con pruebas ambos tipos y los faltantes.

## Out of scope
- Ejecutar la orden o comprobar si el precio límite se alcanza (depende de la evaluación).
- Límite como valor numérico fijo; solo indicador.
- Comparaciones del precio contra el límite; el límite es el valor del indicador.
- Cierres a límite (#16) y varias aperturas.
- Guardar, consultar o modificar estrategias (#2, #3, #5, #6, #7, #10).

## Suggestions (tu decisión)
- Asumo que el precio límite es el valor del indicador en el momento de la apertura y que, si no se elige tipo, la apertura es a mercado (así no cambia lo aprobado en #14). Dime si prefieres que el tipo sea obligatorio.
- El bloque de apertura ya existe; el selector de tipo puede reutilizar el mismo patrón de selector de condición.
