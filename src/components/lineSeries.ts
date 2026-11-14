import { LineSeries, LineStyle, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { type ChartLine, toLineData } from './chartData'

/** Índice del panel inferior (RSI) en charts multi-panel. */
export const LOWER_PANE_INDEX = 1

/** Opciones de una `LineSeries` de indicador (rango fijo opcional vía autoscale). */
export function lineOptions(line: ChartLine) {
  const range = line.fixedRange
  return {
    color: line.color,
    lineWidth: 2 as const,
    priceLineVisible: false,
    lastValueVisible: true,
    title: line.label,
    ...(range === undefined
      ? {}
      : {
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: range.min, maxValue: range.max },
          }),
        }),
  }
}

/**
 * Sincroniza las series de indicadores del chart con `lines`: quita las que
 * desaparecen, crea las nuevas (con sus `referenceLines` punteadas) y actualiza
 * color/título/data de las existentes. `store` es el mapa de series del
 * componente, mutado en el sitio (patrón del effect de `CandleChart`).
 */
export function syncLineSeries(
  chart: IChartApi,
  store: Map<string, ISeriesApi<'Line'>>,
  lines: readonly ChartLine[],
): void {
  const wanted = new Map(lines.map((line) => [line.id, line]))

  for (const [id, series] of [...store]) {
    if (!wanted.has(id)) {
      chart.removeSeries(series)
      store.delete(id)
    }
  }

  for (const line of lines) {
    let series = store.get(line.id)
    if (series === undefined) {
      series = chart.addSeries(
        LineSeries,
        lineOptions(line),
        line.pane === 'lower' ? LOWER_PANE_INDEX : 0,
      )
      store.set(line.id, series)
      for (const price of line.referenceLines ?? []) {
        series.createPriceLine({
          price,
          color: line.color,
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: '',
        })
      }
    } else {
      series.applyOptions({ color: line.color, title: line.label })
    }
    series.setData(toLineData(line.values))
  }
}
