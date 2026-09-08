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

export interface SampleIndex {
  assetId: string;
  timemili: number;
  endTime: number;
  sampleCount: number;
}

export type ChartType = 'line' | 'candlestick' | 'ohlc';
