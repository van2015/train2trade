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
import { CHART_COLORS, priceFormatFor, toCandlestickData } from './chartData'
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
 * Previsualización de estrategia en el área principal (plan
 * `strategy-preview-plan.md`): velas + indicadores del draft + niveles de
 * operación evaluados en la última vela, recortados a la **ventana ajustada**
 * a la estrategia (últimas N velas derivadas de los períodos) con leyenda.
 * Zoom/pan habilitados (la vista de gráfico no tiene scroll propio: la rueda
 * no choca con nada) para poder ampliar la última parte, donde viven los
 * niveles. El cálculo es síncrono (~0.3ms, ver plan); la degradación de
 * drafts rotos vive en `strategyPreview`.
 */
export function StrategyPreviewChart({ candles, spec }: StrategyPreviewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>())
  const levelLinesRef = useRef(new Map<string, IPriceLine>())

  const preview = useMemo(() => buildStrategyPreview(candles, spec), [candles, spec])

  // Velas de la ventana. Memo por primitivas (from/to): cambios de draft que
  // no mueven la ventana preservan la identidad → el effect de abajo no
  // re-encaja y el zoom del usuario sobrevive al teclear.
  const windowed = useMemo(
    () => candles.slice(preview.window.from, preview.window.to),
    [candles, preview.window.from, preview.window.to],
  )

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
      // Zoom/pan habilitados: el preview está en el área principal (la vista
      // de gráfico no tiene scroll propio, la rueda no choca) y el usuario
      // necesita poder ampliar la última parte, donde viven los niveles.
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

  // 2) Velas de la ventana: setData + fitContent SOLO cuando cambia la
  //    ventana real (o las velas), para no resetear el zoom al teclear.
  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    if (chart === null || candleSeries === null) return

    const lastClose = windowed[windowed.length - 1]?.close ?? 0
    candleSeries.applyOptions({ priceFormat: { type: 'price', ...priceFormatFor(lastClose) } })
    candleSeries.setData(toCandlestickData(windowed))
    chart.timeScale().fitContent()
  }, [windowed])

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
      {preview.legend !== null && (
        <div className="strategy-preview__legend" data-testid="preview-legend">
          {preview.legend}
        </div>
      )}
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
