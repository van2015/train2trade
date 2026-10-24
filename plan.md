## Story
Como trader, quiero componer cada condición de la estrategia (entrada, stop loss y take profit) con varias condiciones simples unidas por AND u OR, pudiendo negar cada una con NOT, para expresar reglas más complejas.

## Acceptance criteria
- [ ] Dada una condición de la estrategia (entrada, stop loss o take profit) con una condición simple completa, cuando añado otra condición simple completa y elijo AND u OR como conector, entonces el resumen muestra ambas condiciones unidas por el conector elegido.
- [ ] Dada una composición completa, cuando marco una de sus condiciones simples como negada, entonces el resumen muestra NOT delante de esa condición.
- [ ] Dada una composición con una condición simple incompleta o sin condiciones, cuando intento terminar la estrategia, entonces no queda lista para guardar y veo qué dato falta.

## Plan
- Modelar cada una de las tres condiciones como un grupo de condiciones simples con un conector AND/OR y una marca NOT por condición simple.
- Extender el presentador para añadir, quitar y editar condiciones simples del grupo, reutilizando la condición simple actual (valor o indicador contra indicador).
- Añadir al formulario de cada condición los controles para agregar/quitar condiciones, elegir el conector y marcar NOT.
- Actualizar el resumen y la validación para reflejar la composición y señalar la condición simple incompleta.
- Cubrir con pruebas la composición AND/OR, la negación NOT y la validación de grupos incompletos.

## Out of scope
- Anidar grupos o mezclar AND y OR en una misma condición; si se necesita, se propone una historia aparte.
- Componer entre las tres condiciones de la estrategia (entrada, stop loss y take profit); la composición ocurre dentro de cada una.
- Evaluar las condiciones o generar señales; esta historia solo define y muestra la regla.
- Guardar, listar, consultar el detalle o modificar estrategias guardadas (historias #2, #3, #5, #6 y #7).

## Suggestions (tu decisión)
- Reutilizar el catálogo de indicadores y los controles de condición simple ya existentes para no duplicar opciones ni parámetros.
