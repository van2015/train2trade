# Backlog

## Contexto
App local de análisis de activos donde un trader define, guarda, consulta y modifica estrategias genéricas (entrada, stop loss y take profit) basadas en indicadores y precio.

Stack: el existente del proyecto (React + TypeScript + Vite, persistencia local).

Decisiones caras: ninguna.

## Backlog
1. Como trader, quiero crear una estrategia con nombre y sus tres condiciones (entrada, stop loss y take profit) usando indicador o precio, operador y valor, para dejarla definida y lista para guardar.
4. Como trader, quiero definir condiciones comparando un indicador contra otro y con operadores de cruce, para expresar reglas como "EMA(20) cruza arriba EMA(50)". Requiere: #1
8. Como trader, quiero componer condiciones con AND, OR y NOT, para expresar reglas más complejas combinando condiciones simples. Requiere: #1
2. Como trader, quiero guardar la estrategia definida, para que siga disponible después de recargar. Requiere: #1
3. Como trader, quiero consultar la lista de estrategias guardadas, para encontrar las que he creado. Requiere: #2
5. Como trader, quiero consultar el detalle de una estrategia guardada con sus tres condiciones, para revisar exactamente qué define. Requiere: #3
6. Como trader, quiero modificar la condición de entrada de una estrategia guardada, para ajustarla sin recrearla. Requiere: #5
7. Como trader, quiero modificar las condiciones de stop loss y take profit de una estrategia guardada, para ajustar el riesgo y los objetivos. Requiere: #5
