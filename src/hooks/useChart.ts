import { useRef, useCallback } from 'react';
import { ChartService } from '../services/chart/ChartService';
import { LightweightChartService } from '../services/chart/LightweightChartService';
import { PriceData, ChartType } from '../types/asset';

export function useChart() {
  const chartServiceRef = useRef<ChartService | null>(null);

  const getChartService = useCallback((): ChartService => {
    if (!chartServiceRef.current) {
      chartServiceRef.current = new LightweightChartService();
    }
    return chartServiceRef.current;
  }, []);

  const renderChart = useCallback(
    (type: ChartType, container: HTMLElement, data: PriceData[]) => {
      const service = getChartService();
      service.destroy();

      switch (type) {
        case 'line':
          service.renderLineChart(container, data);
          break;
        case 'candlestick':
          service.renderCandlesticks(container, data);
          break;
        case 'ohlc':
          service.renderOHLC(container, data);
          break;
      }
    },
    [getChartService]
  );

  const destroyChart = useCallback(() => {
    if (chartServiceRef.current) {
      chartServiceRef.current.destroy();
    }
  }, []);

  const updateChartTheme = useCallback(() => {
    if (chartServiceRef.current) {
      chartServiceRef.current.updateTheme();
    }
  }, []);

  return {
    renderChart,
    destroyChart,
    updateChartTheme,
  };
}
