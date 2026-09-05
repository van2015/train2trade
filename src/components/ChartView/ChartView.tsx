import { useEffect, useRef, useCallback } from 'react';
import { useAppPresenter, ViewportRange } from '../../hooks/useAppPresenter';
import { ChartType } from '../../types/asset';
import { PriceData } from '../../types/asset';
import { ChartTypeSelector } from '../ChartTypeSelector/ChartTypeSelector';
import { TimeframeSelector } from '../TimeframeSelector/TimeframeSelector';
import { getChartThemeColors } from '../../utils/chartTheme';
import { createChart, IChartApi, ISeriesApi, SeriesType, Time, LineData, CandlestickData, BarData } from 'lightweight-charts';

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

interface ChartViewProps {
  assetId: string | null;
}

export function ChartView({ assetId }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, getChartData, changeChartType, changeTimeframe, onViewportChange } = useAppPresenter();
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const hasRenderedRef = useRef(false);
  const currentAssetRef = useRef<string | null>(null);
  const currentChartTypeRef = useRef<string | null>(null);

  const data = assetId
    ? getChartData(assetId, state.selectedTimeframe)
    : null;

  const createChartInstance = useCallback((container: HTMLElement) => {
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const colors = getChartThemeColors();

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

  const addSeries = useCallback((type: string) => {
    if (!chartRef.current) return null;

    switch (type) {
      case 'line':
        return chartRef.current.addLineSeries({
          color: '#2962FF',
          lineWidth: 2,
        });
      case 'candlestick':
        return chartRef.current.addCandlestickSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });
      case 'ohlc':
        return chartRef.current.addBarSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
        });
      default:
        return chartRef.current.addLineSeries({
          color: '#2962FF',
          lineWidth: 2,
        });
    }
  }, []);

  const subscribeViewport = useCallback((callback: (range: ViewportRange) => void) => {
    if (!chartRef.current) return;

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (!chartRef.current) return;

      const range = chartRef.current.timeScale().getVisibleRange();
      if (!range) return;

      const fromTime = new Date((range.from as number) * 1000);
      const toTime = new Date((range.to as number) * 1000);

      callback({
        from: fromTime.toISOString(),
        to: toTime.toISOString(),
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
      hasRenderedRef.current = false;
      currentAssetRef.current = null;
      currentChartTypeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!assetId) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
      hasRenderedRef.current = false;
      currentAssetRef.current = null;
      currentChartTypeRef.current = null;
      return;
    }

    const chartTypeChanged = currentChartTypeRef.current !== null && currentChartTypeRef.current !== state.chartType;
    const assetChanged = assetId !== currentAssetRef.current;

    if (assetChanged) {
      currentAssetRef.current = assetId;
      hasRenderedRef.current = false;
    }

    if (chartTypeChanged) {
      hasRenderedRef.current = false;
    }

    currentChartTypeRef.current = state.chartType;

    if (containerRef.current && data) {
      if (!hasRenderedRef.current) {
        const cleanup = createChartInstance(containerRef.current);
        seriesRef.current = addSeries(state.chartType);

        if (seriesRef.current) {
          const chartData = transformChartData(state.chartType, data);
          seriesRef.current.setData(chartData as any);
          chartRef.current?.timeScale().fitContent();
        }

        subscribeViewport(onViewportChange);
        hasRenderedRef.current = true;

        return () => {
          cleanup?.();
        };
      } else if (seriesRef.current) {
        const chartData = transformChartData(state.chartType, data);
        seriesRef.current.setData(chartData as any);
      }
    }
  }, [data, state.chartType, assetId, createChartInstance, addSeries, subscribeViewport, onViewportChange]);

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
      <div className="chart-container" ref={containerRef}>
        {!data && <div className="chart-placeholder">Select an asset to view chart</div>}
      </div>
    </div>
  );
}
