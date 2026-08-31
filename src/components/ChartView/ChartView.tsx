import { useEffect, useRef } from 'react';
import { PriceData, ChartType, Timeframe } from '../../types/asset';
import { useChart } from '../../hooks/useChart';
import { ChartTypeSelector } from '../ChartTypeSelector/ChartTypeSelector';
import { TimeframeSelector } from '../TimeframeSelector/TimeframeSelector';

interface ChartViewProps {
  data: PriceData[] | null;
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}

export function ChartView({
  data,
  chartType,
  onChartTypeChange,
  timeframe,
  onTimeframeChange,
}: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { renderChart, destroyChart } = useChart();

  useEffect(() => {
    return () => {
      destroyChart();
    };
  }, [destroyChart]);

  useEffect(() => {
    if (containerRef.current && data) {
      renderChart(chartType, containerRef.current, data);
    } else {
      destroyChart();
    }
  }, [data, chartType, renderChart, destroyChart]);

  return (
    <div className="chart-view">
      <TimeframeSelector
        value={timeframe}
        onChange={onTimeframeChange}
        disabled={!data}
      />
      <ChartTypeSelector
        value={chartType}
        onChange={onChartTypeChange}
        disabled={!data}
      />
      <div className="chart-container" ref={containerRef}>
        {!data && <div className="chart-placeholder">Select an asset to view chart</div>}
      </div>
    </div>
  );
}
