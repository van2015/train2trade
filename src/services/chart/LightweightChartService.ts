import { ChartService } from './ChartService';
import { PriceData, ChartType } from '../../types/asset';
import { createChart, IChartApi, LineData, CandlestickData, BarData, Time } from 'lightweight-charts';

export class LightweightChartService implements ChartService {
  private chart: IChartApi | null = null;
  private currentType: ChartType | null = null;

  private parseTime(dateStr: string): Time {
    const date = new Date(dateStr);
    return Math.floor(date.getTime() / 1000) as Time;
  }

  private toLineData(data: PriceData[]): LineData<Time>[] {
    return data.map(d => ({
      time: this.parseTime(d.date),
      value: d.close,
    }));
  }

  private toCandlestickData(data: PriceData[]): CandlestickData<Time>[] {
    return data.map(d => ({
      time: this.parseTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }

  private toBarData(data: PriceData[]): BarData<Time>[] {
    return data.map(d => ({
      time: this.parseTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }

  private createChartContainer(container: HTMLElement): void {
    if (this.chart) {
      this.chart.remove();
    }

    this.chart = createChart(container, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333333',
      },
      grid: {
        vertLines: { color: '#e0e0e0' },
        horzLines: { color: '#e0e0e0' },
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    window.addEventListener('resize', () => {
      if (this.chart && container.clientWidth > 0) {
        this.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
  }

  renderLineChart(container: HTMLElement, data: PriceData[]): void {
    this.createChartContainer(container);

    if (!this.chart) return;

    const series = this.chart.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
    });

    series.setData(this.toLineData(data));
    this.chart.timeScale().fitContent();
    this.currentType = 'line';
  }

  renderCandlesticks(container: HTMLElement, data: PriceData[]): void {
    this.createChartContainer(container);

    if (!this.chart) return;

    const series = this.chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    series.setData(this.toCandlestickData(data));
    this.chart.timeScale().fitContent();
    this.currentType = 'candlestick';
  }

  renderOHLC(container: HTMLElement, data: PriceData[]): void {
    this.createChartContainer(container);

    if (!this.chart) return;

    const series = this.chart.addBarSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
    });

    series.setData(this.toBarData(data));
    this.chart.timeScale().fitContent();
    this.currentType = 'ohlc';
  }

  destroy(): void {
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
      this.currentType = null;
    }
  }

  switchChartType(type: ChartType, container: HTMLElement, data: PriceData[]): void {
    if (type === this.currentType) return;

    switch (type) {
      case 'line':
        this.renderLineChart(container, data);
        break;
      case 'candlestick':
        this.renderCandlesticks(container, data);
        break;
      case 'ohlc':
        this.renderOHLC(container, data);
        break;
    }
  }
}
