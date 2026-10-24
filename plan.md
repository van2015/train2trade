## Story
Como trader, quiero que una estrategia abra una posición en largo o en corto a mercado, al cumplirse la condición que elijo (entrada, stop loss o take profit), con el porcentaje de riesgo que defino, para entrar en operaciones con un riesgo controlado.

## Acceptance criteria
- [ ] Dado que estoy definiendo una estrategia, cuando elijo largo o corto, un porcentaje de riesgo y la condición que dispara la apertura (entrada, stop loss o take profit), entonces el resumen muestra la dirección, la apertura a mercado, el riesgo y la condición, y la estrategia queda lista para guardar si lo demás está completo.
- [ ] Dado que no he elegido dirección, riesgo o condición de disparo, cuando intento terminar la definición, entonces la estrategia no queda lista para guardar y veo qué falta.
- [ ] Dado que el porcentaje de riesgo no es un número mayor que cero, cuando intento terminar la definición, entonces la estrategia no queda lista para guardar.

## Plan
- Añadir al borrador de la estrategia la dirección (largo o corto), el porcentaje de riesgo y la condición que dispara la apertura (entrada, stop loss o take profit), con la apertura a mercado como única opción.
- Incluir estos campos en la validación de "lista para guardar", junto al nombre y las tres condiciones.
- Añadir al formulario un bloque de apertura con selector de dirección, selector de condición de disparo y campo numérico de riesgo.
- Mostrar la apertura en el resumen, solo cuando la estrategia está completa.
- Cubrir con pruebas los campos faltantes, el riesgo no válido y el resumen con dirección, riesgo y disparo.

## Out of scope
- Ejecutar la apertura o calcular el tamaño de la posición a partir del riesgo (depende del capital y se verá con la evaluación).
- Apertura a límite (#15).
- Acciones de cierre (#11, #12, #16) y varias acciones (#13).
- Varias condiciones de disparo para una misma apertura.
- Guardar, consultar o modificar estrategias (#2, #3, #5, #6, #7, #10).
- Integración con el motor de trading existente (TradingEngine).

## Suggestions (tu decisión)
- Asumo que cada apertura tiene exactamente una condición de disparo, que dirección, riesgo y disparo son obligatorios, y que el riesgo es un número mayor que cero. Dime si alguna no es así.
- Los faltantes y el resumen ya se calculan en el presenter con el mismo patrón que las condiciones; los nuevos campos pueden seguir ese patrón.
