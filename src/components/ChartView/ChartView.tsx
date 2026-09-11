import { useEffect, useRef, useCallback } from 'react';
import { useAppPresenter } from '../../hooks/useAppPresenter';
import { ChartType } from '../../types/asset';
import { IndicatorPlot, PriceData } from '../../types/asset';
import { ChartTypeSelector } from '../ChartTypeSelector/ChartTypeSelector';
import { TimeframeSelector } from '../TimeframeSelector/TimeframeSelector';
import { IndicatorSelector } from '../IndicatorSelector/IndicatorSelector';
import { getChartThemeColors } from '../../utils/chartTheme';
import { compute, getDefinition } from '../../services/IndicatorService';
import { Interval } from '../../utils/Interval';
import { createTimeLabelFormatter } from '../../utils/timeLabel';
import { Timeframe as TimeframeType } from '../../timeframe/Timeframe';
import { createChart, IChartApi, IPaneApi, ISeriesApi, SeriesType, Time, LineData, CandlestickData, BarData, LineSeries, CandlestickSeries, BarSeries, HistogramSeries } from 'lightweight-charts';

function parseTime(dateStr: string): Time {
  const date = new Date(dateStr);
  return Math.floor(date.getTime() / 1000) as Time;
}

function toLineData(data: PriceData[]): LineData<Time>[] {
  return data.map(d => ({
    time: parseTime(d.date),
    value: d.close,
  }));
}

function toCandlestickData(data: PriceData[]): CandlestickData<Time>[] {
  return data.map(d => ({
    time: parseTime(d.date),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toBarData(data: PriceData[]): BarData<Time>[] {
  return data.map(d => ({
    time: parseTime(d.date),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function transformChartData(type: ChartType, data: PriceData[]): unknown[] {
  switch (type) {
    case 'line':
      return toLineData(data);
    case 'candlestick':
      return toCandlestickData(data);
    case 'ohlc':
      return toBarData(data);
    default:
      return toLineData(data);
  }
}

interface IndicatorSeriesRef {
  plotKey: string;
  series: ISeriesApi<SeriesType>;
}

interface ChartViewProps {
  assetId: string | null;
}

export function ChartView({ assetId }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    state,
    priceSample,
    requestRange,
    getCurrentRange,
    hasCompleteData,
    changeChartType,
    changeTimeframe,
    addIndicator,
    removeIndicator,
  } = useAppPresenter();
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, IndicatorSeriesRef[]>>(new Map());
  const hasFitContentRef = useRef(false);
  const preRangeRef = useRef<Interval | null>(null);
  const pendingRangeRef = useRef<Interval | null>(null);

  const data = assetId
    ? priceSample(assetId, state.selectedTimeframe)
    : null;

  const indicatorSignature = state.activeIndicators
    .map(indicator =>
      `${indicator.key}:${indicator.indicatorId}:${JSON.stringify(indicator.params)}:${indicator.color ?? ''}`
    )
    .join('|');

  const createChartInstance = useCallback((container: HTMLElement, timeframe: TimeframeType) => {
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorSeriesRef.current = new Map();
    }

    const colors = getChartThemeColors();
    const formatTime = createTimeLabelFormatter(timeframe);

    chartRef.current = createChart(container, {
      layout: {
        background: { color: colors.chartBg },
        textColor: colors.chartText,
      },
      grid: {
        vertLines: { color: colors.chartGrid },
        horzLines: { color: colors.chartGrid },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      localization: {
        timeFormatter: (time: Time) => formatTime(Number(time)),
      },
    });

    const handleResize = () => {
      if (chartRef.current && container.clientWidth > 0) {
        chartRef.current.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const addSeries = useCallback((type: string): ISeriesApi<SeriesType> | null => {
    if (!chartRef.current) return null;

    switch (type) {
      case 'line':
        return chartRef.current.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 2,
        });
      case 'candlestick':
        return chartRef.current.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });
      case 'ohlc':
        return chartRef.current.addSeries(BarSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
        });
      default:
        return chartRef.current.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 2,
        });
    }
  }, []);

  const addPlotSeries = useCallback(
    (pane: IPaneApi<Time>, plot: IndicatorPlot): ISeriesApi<SeriesType> => {
      if (plot.style === 'histogram') {
        return pane.addSeries(HistogramSeries, { color: plot.color });
      }
      return pane.addSeries(LineSeries, { color: plot.color, lineWidth: 2 });
    },
    []
  );

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        indicatorSeriesRef.current = new Map();
      }
    };
  }, []);

  useEffect(() => {
    if (!assetId || !containerRef.current) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        indicatorSeriesRef.current = new Map();
      }
      return;
    }

    const resizeCleanup = createChartInstance(containerRef.current, state.selectedTimeframe);
    seriesRef.current = addSeries(state.chartType);
    indicatorSeriesRef.current = new Map();
    hasFitContentRef.current = false;

    const chart = chartRef.current;
    if (chart) {
      const pricePane = chart.panes()[0];
      if (pricePane) pricePane.setStretchFactor(3);

      for (const instance of state.activeIndicators) {
        const definition = getDefinition(instance.indicatorId);
        if (!definition) continue;
        const pane =
          definition.pane === 'separate' ? chart.addPane() : pricePane;
        if (!pane) continue;

        const entries: IndicatorSeriesRef[] = [];
        for (const plot of compute(instance, [])) {
          entries.push({ plotKey: plot.key, series: addPlotSeries(pane, plot) });
        }
        indicatorSeriesRef.current.set(instance.key, entries);
      }
    }

    return () => {
      resizeCleanup?.();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        indicatorSeriesRef.current = new Map();
      }
    };
  }, [assetId, state.chartType, indicatorSignature, createChartInstance, addSeries, addPlotSeries]);

  useEffect(() => {
    if (!seriesRef.current || !data) return;

    seriesRef.current.setData(transformChartData(state.chartType, data) as any);

    for (const [instanceKey, entries] of indicatorSeriesRef.current) {
      const instance = state.activeIndicators.find(candidate => candidate.key === instanceKey);
      if (!instance) continue;
      const plots = compute(instance, data);
      for (const { plotKey, series } of entries) {
        const plot = plots.find(candidate => candidate.key === plotKey);
        if (plot) series.setData(plot.data as any);
      }
    }

    if (!hasFitContentRef.current) {
      hasFitContentRef.current = true;
      const range = getCurrentRange();
      if (range) {
        chartRef.current?.timeScale().setVisibleRange({
          from: range.from / 1000 as Time,
          to: range.to / 1000 as Time,
        });
      } else {
        chartRef.current?.timeScale().fitContent();
      }
      seriesRef.current.priceScale().applyOptions({ autoScale: false });
    } else if (pendingRangeRef.current) {
      const pending = pendingRangeRef.current;
      pendingRangeRef.current = null;
      chartRef.current?.timeScale().setVisibleRange({
        from: pending.from / 1000 as Time,
        to: pending.to / 1000 as Time,
      });
    }
  }, [data, state.chartType, indicatorSignature, getCurrentRange]);

  useEffect(() => {
    if (!chartRef.current) return;
    const formatTime = createTimeLabelFormatter(state.selectedTimeframe);
    chartRef.current.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatTime(Number(time)),
      },
    });
  }, [state.selectedTimeframe]);

  useEffect(() => {
    if (!assetId || !containerRef.current) return;
    const container = containerRef.current;
    const DRAG_THRESHOLD = 4;
    let dragging = false;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const range = chartRef.current?.timeScale().getVisibleRange();
      if (!range) return;
      const fromSec = Number(range.from);
      const toSec = Number(range.to);
      if (Number.isNaN(fromSec) || Number.isNaN(toSec)) return;
      preRangeRef.current = new Interval(Math.floor(fromSec * 1000), Math.ceil(toSec * 1000));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD;
      if (!moved) return;
      const pre = preRangeRef.current;
      if (!pre) return;
      const range = chartRef.current?.timeScale().getVisibleRange();
      if (!range) return;
      const fromSec = Number(range.from);
      const toSec = Number(range.to);
      if (Number.isNaN(fromSec) || Number.isNaN(toSec)) return;
      const post = new Interval(Math.floor(fromSec * 1000), Math.ceil(toSec * 1000));
      const next = pre.movedTo(post);
      if (!next || hasCompleteData(next)) return;
      pendingRangeRef.current = next;
      requestRange(assetId, next);
    };

    container.addEventListener('pointerdown', onPointerDown, true);
    container.addEventListener('pointerup', onPointerUp, true);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [assetId, requestRange, hasCompleteData]);

  useEffect(() => {
    const handleThemeChange = () => {
      if (!chartRef.current) return;

      const colors = getChartThemeColors();
      chartRef.current.applyOptions({
        layout: {
          background: { color: colors.chartBg },
          textColor: colors.chartText,
        },
        grid: {
          vertLines: { color: colors.chartGrid },
          horzLines: { color: colors.chartGrid },
        },
      });
    };

    window.addEventListener('themechange', handleThemeChange);
    return () => window.removeEventListener('themechange', handleThemeChange);
  }, []);

  return (
    <div className="chart-view">
      <TimeframeSelector
        value={state.selectedTimeframe}
        onChange={changeTimeframe}
        disabled={!data}
      />
      <ChartTypeSelector
        value={state.chartType}
        onChange={changeChartType}
        disabled={!data}
      />
      <IndicatorSelector
        indicators={state.activeIndicators}
        onAdd={addIndicator}
        onRemove={removeIndicator}
        disabled={!data}
      />
      <div className="chart-container" ref={containerRef}>
        {!data && state.selectedAssetId && <div className="chart-placeholder">Loading chart...</div>}
        {!data && !state.selectedAssetId && <div className="chart-placeholder">Select an asset to view chart</div>}
      </div>
    </div>
  );
}
