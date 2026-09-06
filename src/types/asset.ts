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

export interface Asset {
  id: string;
  name: string;
  data: PriceData[];
  createdAt: Date;
  originalTimeframe: Timeframe;
}

export interface AssetSummary {
  id: string;
  name: string;
  createdAt: Date;
  originalTimeframe: Timeframe;
}

export type ChartType = 'line' | 'candlestick' | 'ohlc';
