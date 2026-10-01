import { Timeframe } from '../../backtest/timeframe/Timeframe';

export type { Timeframe };

export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetSummary {
  id: string;
  name: string;
  createdAt: Date;
  originalTimeframe: Timeframe;
}

export type ChartType = 'line' | 'candlestick' | 'ohlc';

export type IndicatorId = 'sma' | 'ema' | 'bb' | 'rsi' | 'macd' | 'volume';

export type IndicatorPane = 'overlay' | 'separate';

export type IndicatorPlotStyle = 'line' | 'histogram';

export interface IndicatorInstance {
  key: string;
  indicatorId: IndicatorId;
  params: Record<string, number>;
  color?: string;
}

export interface IndicatorPlotPoint {
  time: number;
  value?: number;
  color?: string;
}

export interface IndicatorPlot {
  key: string;
  label: string;
  style: IndicatorPlotStyle;
  color: string;
  data: IndicatorPlotPoint[];
}

export interface IndicatorSeries {
  key: string;
  values: (number | undefined)[];
}

export interface IndicatorParamSpec {
  key: string;
  label: string;
  default: number;
  min?: number;
}

export interface IndicatorSeriesSpec {
  key: string;
  label: (params: Record<string, number>) => string;
  style: IndicatorPlotStyle;
  color: string;
  colorForValue?: (value: number, index: number, candle: PriceData) => string;
  computeValues: (candles: PriceData[], params: Record<string, number>) => (number | undefined)[];
}

export interface IndicatorDefinition {
  id: IndicatorId;
  label: string;
  pane: IndicatorPane;
  params: IndicatorParamSpec[];
  lookback: (params: Record<string, number>) => number;
  series: IndicatorSeriesSpec[];
}
