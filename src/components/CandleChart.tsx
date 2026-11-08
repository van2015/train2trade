import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { Candle } from '@/domain/candles/candle'
import {
  CHART_COLORS,
  type ChartLine,
  formatChartPrice,
  formatChartTime,
  priceFormatFor,
  toChartTime,
  toCandlestickData,
  toLineData,
  toVolumeData,
} from './chartData'

/** Índice del panel inferior donde viven los indicadores en panel propio (RSI). */
const LOWER_PANE_INDEX = 1

export interface CandleChartProps {
  candles: readonly Candle[]
  lines: readonly ChartLine[]
}

function lineOptions(line: ChartLine) {
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
 * Gráfico de velas con volumen e indicadores superpuestos.
 *
 * - El gráfico se crea una sola vez y se destruye al desmontar.
 * - Los datos de velas/volumen se actualizan cuando cambia `candles` (con `fitContent`,
 *   de modo que cambiar de indicador no resetea el zoom del usuario).
 * - Las líneas de indicador se sincronizan por id: se crean, actualizan y eliminan
 *   según `lines`. Las de `pane: 'lower'` viven en un panel inferior automático.
 */
export function CandleChart({ candles, lines }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineSeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const candlesBySecondRef = useRef(new Map<number, Candle>())
  const [hovered, setHovered] = useState<Candle | null>(null)

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
      crosshair: { mode: CrosshairMode.Normal },
      handleScale: true,
      handleScroll: true,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.up,
      downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up,
      borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up,
      wickDownColor: CHART_COLORS.down,
      priceLineVisible: false,
    })

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    chart.subscribeCrosshairMove((param) => {
      const time = param.time
      if (typeof time !== 'number') {
        setHovered(null)
        return
      }
      setHovered(candlesBySecondRef.current.get(time) ?? null)
    })

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      lineSeriesRef.current.clear()
      candlesBySecondRef.current.clear()
    }
  }, [])

  // 2) Velas y volumen.
  useEffect(() => {
    candlesBySecondRef.current = new Map(
      candles.map((candle) => [toChartTime(candle.time), candle]),
    )

    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (chart === null || candleSeries === null || volumeSeries === null) return

    const lastClose = candles[candles.length - 1]?.close ?? 0
    candleSeries.applyOptions({ priceFormat: { type: 'price', ...priceFormatFor(lastClose) } })
    candleSeries.setData(toCandlestickData(candles))
    volumeSeries.setData(toVolumeData(candles))
    chart.timeScale().fitContent()
  }, [candles])

  // 3) Series de indicadores: se crean, actualizan y eliminan según `lines`.
  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return

    const wanted = new Map(lines.map((line) => [line.id, line]))

    for (const [id, series] of [...lineSeriesRef.current]) {
      if (!wanted.has(id)) {
        chart.removeSeries(series)
        lineSeriesRef.current.delete(id)
      }
    }

    for (const line of lines) {
      let series = lineSeriesRef.current.get(line.id)
      if (series === undefined) {
        series = chart.addSeries(
          LineSeries,
          lineOptions(line),
          line.pane === 'lower' ? LOWER_PANE_INDEX : 0,
        )
        lineSeriesRef.current.set(line.id, series)
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
  }, [lines])

  const lastCandle = candles[candles.length - 1]
  const legend = hovered ?? lastCandle ?? null

  return (
    <div className="candle-chart">
      <div className="candle-chart__canvas" ref={containerRef} />
      {legend !== null && (
        <div className="candle-chart__legend" data-testid="chart-legend">
          <span className="candle-chart__legend-time">{formatChartTime(legend.time)}</span>
          <span>
            Apertura <b>{formatChartPrice(legend.open)}</b>
          </span>
          <span>
            Máximo <b>{formatChartPrice(legend.high)}</b>
          </span>
          <span>
            Mínimo <b>{formatChartPrice(legend.low)}</b>
          </span>
          <span>
            Cierre{' '}
            <b className={legend.isBullish ? 'is-up' : 'is-down'}>
              {formatChartPrice(legend.close)}
            </b>
          </span>
          <span>
            Volumen <b>{formatChartPrice(legend.volume)}</b>
          </span>
        </div>
      )}
      {candles.length === 0 && (
        <div className="candle-chart__empty" data-testid="chart-empty">
          Sin datos para mostrar. Importa un CSV o descarga velas del exchange.
        </div>
      )}
    </div>
  )
}
