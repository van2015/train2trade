## Story
Como trader, quiero crear una estrategia con nombre y sus tres condiciones (entrada, stop loss y take profit) usando indicadores, operador y valor, para dejarla definida y lista para guardar.

## Acceptance criteria
- [ ] Dado que estoy creando una estrategia, cuando introduzco un nombre y completo las condiciones de entrada, stop loss y take profit (cada una con indicador, operador y valor), entonces veo la estrategia definida con un resumen de sus tres condiciones y lista para guardar.
- [ ] Dada una condición, cuando elijo un indicador, entonces puedo elegir entre cierre, apertura, máximo, mínimo y los indicadores técnicos de la app, ajustando los parámetros de estos últimos.
- [ ] Dado que falta el nombre o alguna de las tres condiciones está incompleta, cuando intento terminar la creación, entonces la estrategia no queda lista para guardar y veo qué dato falta.

## Plan
- Añadir en la barra lateral un acceso a "Estrategias" con un formulario de nueva estrategia: nombre y tres bloques de condición.
- Modelar la definición en memoria: indicador (cierre, apertura, máximo, mínimo o técnico con parámetros), operador y valor numérico para entrada, stop loss y take profit.
- Incorporar cierre, apertura, máximo y mínimo al catálogo de indicadores disponible para condiciones, reutilizando el catálogo técnico existente.
- Validar nombre y las tres condiciones antes de marcar la estrategia como lista, mostrando un resumen de la definición.
- Cubrir con pruebas la validación de la definición y el flujo de completar/dejar incompleta una condición.

## Out of scope
- Guardar, listar y consultar el detalle (historias #2, #3 y #5).
- Comparar indicador contra indicador y operadores de cruce (historia #4).
- Modificar estrategias guardadas (historias #6 y #7).
- Evaluar estrategias, generar señales o asociarlas a un activo/timeframe.
- Eliminar o duplicar estrategias.

## Suggestions (tu decisión)
- Reutilizar las definiciones de indicadores de la app para poblar las opciones y parámetros, y no duplicar etiquetas ni valores por defecto.
