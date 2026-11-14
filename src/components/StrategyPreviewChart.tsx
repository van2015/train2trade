import { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type CreatePriceLineOptions,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
} from 'lightweight-charts'
import { Candle } from '@/domain/candles/candle'
import { StrategySpec } from '@/domain/strategies/spec'
import { CHART_COLORS, priceFormatFor, toChartTime, toCandlestickData } from './chartData'
import { syncLineSeries } from './lineSeries'
import { buildStrategyPreview, PreviewLevel } from './strategyPreview'

export interface StrategyPreviewChartProps {
  candles: readonly Candle[]
  spec: StrategySpec
}

/** Nivel horizontal: punteado con etiqueta en el eje (mismo estilo que las referenciales). */
function levelOptions(level: PreviewLevel): CreatePriceLineOptions {
  return {
    price: level.price,
    color: level.color,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: level.label,
  }
}

/**
 * Minichart de previsualización del editor (plan `strategy-preview-plan.md`):
 * velas + indicadores del draft + niveles de operación evaluados en la última
 * vela. Sin leyenda, sin volumen y sin scroll/zoom (en la sidebar la rueda
 * debe seguir scrolleando). El cálculo es síncrono (~0.3ms, ver plan); la
 * degradación de drafts rotos vive en `strategyPreview`.
 */
export function StrategyPreviewChart({ candles, spec }: StrategyPreviewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const levelLinesRef = useRef(new Map<string, IPriceLine>())

  const preview = useMemo(() => buildStrategyPreview(candles, spec), [candles, spec])

  // 1) Creación y destrucción del chart.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: CHART_COLORS.background },
        textColor: CHART_COLORS.text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: CHART_COLORS.grid },
        horzLines: { color: CHART_COLORS.grid },
      },
      rightPriceScale: { borderColor: CHART_COLORS.border },
      timeScale: { borderColor: CHART_COLORS.border, timeVisible: true, secondsVisible: false },
      // Rueda del ratón sin capturar: en la sidebar debe scrollear el sidebar.
      handleScale: false,
      handleScroll: false,
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

    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      lineSeriesRef.current.clear()
      levelLinesRef.current.clear()
    }
  }, [])

  // 2) Velas (fitContent en cada cambio; sin zoom posterior).
  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    if (chart === null || candleSeries === null) return

    const lastClose = candles[candles.length - 1]?.close ?? 0
    candleSeries.applyOptions({ priceFormat: { type: 'price', ...priceFormatFor(lastClose) } })
    candleSeries.setData(toCandlestickData(candles))
    chart.timeScale().fitContent()
  }, [candles])

  // 3) Series de indicadores del draft.
  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return

    syncLineSeries(chart, lineSeriesRef.current, preview.lines)
  }, [preview.lines])

  // 4) Niveles (entrada/TP/SL/triggers) como líneas de precio sincronizadas.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (candleSeries === null) return

    const wanted = new Map(preview.levels.map((level) => [level.id, level]))

    for (const [id, priceLine] of [...levelLinesRef.current]) {
      if (!wanted.has(id)) {
        candleSeries.removePriceLine(priceLine)
        levelLinesRef.current.delete(id)
      }
    }

    for (const level of preview.levels) {
      const existing = levelLinesRef.current.get(level.id)
      if (existing === undefined) {
        levelLinesRef.current.set(level.id, candleSeries.createPriceLine(levelOptions(level)))
      } else {
        existing.applyOptions(levelOptions(level))
      }
    }
  }, [preview.levels])

  return (
    <div className="strategy-preview" data-testid="strategy-preview">
      <div className="strategy-preview__canvas" ref={containerRef} />
      {candles.length === 0 ? (
        <div className="strategy-preview__empty" data-testid="preview-empty">
          {preview.note ?? 'Sin datos para previsualizar'}
        </div>
      ) : (
        preview.note !== null && (
          <p className="strategy-preview__note" data-testid="preview-note">
            {preview.note}
          </p>
        )
      )}
    </div>
  )
}
