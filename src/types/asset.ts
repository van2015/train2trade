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
}

export type ChartType = 'line' | 'candlestick' | 'ohlc';
