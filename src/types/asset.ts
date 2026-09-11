import { Timeframe } from '../timeframe/Timeframe';

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

export interface IndicatorParamSpec {
  key: string;
  label: string;
  default: number;
  min?: number;
}

export interface IndicatorDefinition {
  id: IndicatorId;
  label: string;
  pane: IndicatorPane;
  params: IndicatorParamSpec[];
  lookback: (params: Record<string, number>) => number;
  compute: (candles: PriceData[], params: Record<string, number>) => IndicatorPlot[];
}
