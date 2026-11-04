# Backlog — App de estrategias de trading

## Context

App para que traders creen estrategias de trading de criptomonedas sin código y las evalúen con backtesting (win rate + métricas estándar) y paper trading en tiempo real.

Stack: React + TypeScript con toda la lógica en el navegador, datos de precios desde una API pública de exchange, persistencia local (sin backend ni cuentas).

Expensive decisions: ninguna (sin multi-tenant, sin roles de permisos, sin offline/sync, sin multi-idioma ni multi-moneda).

## Backlog

1. Como trader, quiero ver el gráfico de velas histórico de un par de criptomonedas con un timeframe seleccionable, para poder analizar el precio.
2. Como trader, quiero crear una estrategia visualmente combinando indicadores con condiciones de entrada y salida, para definir mis reglas sin escribir código. Requiere: #1
3. Como trader, quiero listar, reabrir, editar y eliminar mis estrategias guardadas en el navegador, para mantener mi trabajo actualizado. Requiere: #2
4. Como trader, quiero ejecutar un backtest de una estrategia en un rango de fechas y ver métricas como win rate y métricas estándar de rendimiento, para evaluar su desempeño. Requiere: #1, #2
5. Como trader, quiero ver las operaciones del backtest marcadas sobre el gráfico y en una lista detallada, para entender cada decisión de la estrategia. Requiere: #4
6. Como trader, quiero ver los resultados de mis backtests guardados, para volver a consultar evaluaciones anteriores. Requiere: #4
7. Como trader, quiero operar en paper trading con precios en vivo usando una de mis estrategias y ver los resultados de la sesión, para probarla en tiempo real sin dinero real. Requiere: #2
