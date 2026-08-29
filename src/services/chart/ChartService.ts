import { PriceData, ChartType } from '../../types/asset';

export interface ChartService {
  renderLineChart(container: HTMLElement, data: PriceData[]): void;
  renderCandlesticks(container: HTMLElement, data: PriceData[]): void;
  renderOHLC(container: HTMLElement, data: PriceData[]): void;
  destroy(): void;
  switchChartType(type: ChartType, container: HTMLElement, data: PriceData[]): void;
}
