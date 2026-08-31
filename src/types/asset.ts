export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W';

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1D': 1440,
  '1W': 10080,
};

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

export type ChartType = 'line' | 'candlestick' | 'ohlc';
