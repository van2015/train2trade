import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { EquityPoint } from '@/domain/backtest/metrics'
import { CHART_COLORS, toEquityAreaData } from './chartData'

export interface EquityChartProps {
  /** Curva de equity del backtest (un punto por cierre de vela). */
  points: readonly EquityPoint[]
}

/** Equity curve del backtest (Fase 4): serie de área con el mismo tema que `CandleChart`. */
export function EquityChart({ points }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  // 1) Creación y destrucción del gráfico.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      rightPriceScale: { borderColor: CHART_COLORS.border },
      timeScale: { borderColor: CHART_COLORS.border, timeVisible: true, secondsVisible: false },
    })

    const series = chart.addSeries(AreaSeries, {
      lineColor: CHART_COLORS.equity,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'Equity',
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // 2) Datos de la curva.
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (chart === null || series === null) return

    series.setData(toEquityAreaData(points))
    chart.timeScale().fitContent()
  }, [points])

  return (
    <div className="equity-chart">
      <div className="equity-chart__canvas" ref={containerRef} />
    </div>
  )
}
