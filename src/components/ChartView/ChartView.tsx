import { useEffect, useRef } from 'react';
import { useAppPresenter } from '../../hooks/useAppPresenter';
import { useChart } from '../../hooks/useChart';
import { ChartTypeSelector } from '../ChartTypeSelector/ChartTypeSelector';
import { TimeframeSelector } from '../TimeframeSelector/TimeframeSelector';

interface ChartViewProps {
  assetId: string | null;
}

export function ChartView({ assetId }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { state, getTimeframeData, changeChartType, changeTimeframe } = useAppPresenter();
  const { renderChart, destroyChart, updateChartTheme } = useChart();

  const data = assetId
    ? getTimeframeData(assetId, state.selectedTimeframe)
    : null;

  useEffect(() => {
    return () => {
      destroyChart();
    };
  }, [destroyChart]);

  useEffect(() => {
    if (containerRef.current && data) {
      renderChart(state.chartType, containerRef.current, data);
    } else {
      destroyChart();
    }
  }, [data, state.chartType, renderChart, destroyChart]);

  useEffect(() => {
    const handleThemeChange = () => {
      updateChartTheme();
    };

    window.addEventListener('themechange', handleThemeChange);
    return () => window.removeEventListener('themechange', handleThemeChange);
  }, [updateChartTheme]);

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
