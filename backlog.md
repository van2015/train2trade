# Backlog

## Contexto
App local de análisis de activos donde un trader define, guarda, consulta y modifica estrategias genéricas (entrada, stop loss y take profit) basadas en indicadores y precio.

Stack: el existente del proyecto (React + TypeScript + Vite, persistencia local).

Decisiones caras: ninguna.

## Backlog
1. [x] Como trader, quiero crear una estrategia con nombre y sus tres condiciones (entrada, stop loss y take profit) usando indicador o precio, operador y valor, para dejarla definida y lista para guardar.
4. [x] Como trader, quiero definir condiciones comparando un indicador contra otro y con operadores de cruce, para expresar reglas como "EMA(20) cruza arriba EMA(50)". Requiere: #1
8. [x] Como trader, quiero componer condiciones con AND, OR y NOT, para expresar reglas más complejas combinando condiciones simples. Requiere: #1
9. Como trader, quiero añadir a una estrategia una acción que mueva el stop loss al precio de entrada cuando se alcance el take profit, para proteger la posición una vez alcanzado el objetivo. Requiere: #1
10. Como trader, quiero modificar la acción de una estrategia guardada, para cambiar cómo reacciona sin recrearla. Requiere: #9
11. Como trader, quiero añadir a una estrategia una acción que cierre la posición completa cuando se alcance el stop loss o el take profit, para salir del trade automáticamente. Requiere: #1
12. Como trader, quiero añadir a una estrategia una acción que cierre parcialmente la posición, con el porcentaje que elijo al definirla, cuando se alcance el stop loss o el take profit, para asegurar parte del resultado. Requiere: #1
13. Como trader, quiero definir varias acciones en una misma estrategia, para combinarlas (por ejemplo, cerrar un 50% y mover el stop loss a la entrada al alcanzar el take profit). Requiere: #9, #12
2. Como trader, quiero guardar la estrategia definida, para que siga disponible después de recargar. Requiere: #1
3. Como trader, quiero consultar la lista de estrategias guardadas, para encontrar las que he creado. Requiere: #2
5. Como trader, quiero consultar el detalle de una estrategia guardada con sus tres condiciones, para revisar exactamente qué define. Requiere: #3
6. Como trader, quiero modificar la condición de entrada de una estrategia guardada, para ajustarla sin recrearla. Requiere: #5
7. Como trader, quiero modificar las condiciones de stop loss y take profit de una estrategia guardada, para ajustar el riesgo y los objetivos. Requiere: #5
