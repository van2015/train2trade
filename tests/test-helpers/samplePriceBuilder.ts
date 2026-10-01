import { PriceData } from '../../src/shared/types/asset';
import { Timeframe } from '../../src/backtest/timeframe/Timeframe';

type CandleType = 'green' | 'red' | 'doji' | 'custom';

interface SamplePriceConfig {
  type: CandleType;
  percent: number;
  timeframe: Timeframe;
  count: number;
  startDate: string;
  startPrice: number;
  volume: number;
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

interface CustomCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class SamplePriceBuilder {
  private config: SamplePriceConfig = {
    type: 'green',
    percent: 2,
    timeframe: '1m',
    count: 1,
    startDate: '2024-01-01T00:00:00Z',
    startPrice: 100,
    volume: 1000,
  };

  private customCandles: CustomCandle[] = [];

  constructor() {}

  static fromCloses(
    closes: number[],
    options: {
      opens?: number[];
      volumes?: number[];
      startDate?: string;
      timeframe?: Timeframe;
    } = {}
  ): PriceData[] {
    const startDate = options.startDate ?? '2024-01-01T00:00:00Z';
    const builder = new SamplePriceBuilder()
      .timeframe(options.timeframe ?? '1m')
      .startDate(startDate);
    const timeframeMinutes = builder.getTimeframeMinutes();
    const startTime = new Date(startDate).getTime();

    closes.forEach((close, index) => {
      const open = options.opens?.[index] ?? close;
      const date = new Date(startTime + index * timeframeMinutes * 60 * 1000);
      builder.add(
        builder.formatDate(date),
        open,
        Math.max(open, close),
        Math.min(open, close),
        close,
        options.volumes?.[index] ?? 1
      );
    });

    return builder.buildSeries();
  }

  add(
    date: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volume?: number
  ): this {
    this.customCandles.push({ date, open, high, low, close, volume });
    return this;
  }

  green(percent: number = 2): this {
    this.config.type = 'green';
    this.config.percent = percent;
    return this;
  }

  red(percent: number = 2): this {
    this.config.type = 'red';
    this.config.percent = percent;
    return this;
  }

  doji(): this {
    this.config.type = 'doji';
    return this;
  }

  timeframe(tf: Timeframe): this {
    this.config.timeframe = tf;
    return this;
  }

  count(n: number): this {
    this.config.count = n;
    return this;
  }

  startDate(date: string): this {
    this.config.startDate = date;
    return this;
  }

  startPrice(price: number): this {
    this.config.startPrice = price;
    return this;
  }

  date(d: string): this {
    this.config.date = d;
    return this;
  }

  open(v: number): this {
    this.config.open = v;
    this.config.type = 'custom';
    return this;
  }

  high(v: number): this {
    this.config.high = v;
    this.config.type = 'custom';
    return this;
  }

  low(v: number): this {
    this.config.low = v;
    this.config.type = 'custom';
    return this;
  }

  close(v: number): this {
    this.config.close = v;
    this.config.type = 'custom';
    return this;
  }

  volume(v: number): this {
    this.config.volume = v;
    return this;
  }

  buildOne(): PriceData {
    const open = this.config.open ?? this.config.startPrice;
    const calculated = this.calculateCandleValues(open);

    return {
      date: this.config.date ?? this.config.startDate,
      open,
      high: this.config.high ?? calculated.high,
      low: this.config.low ?? calculated.low,
      close: this.config.close ?? calculated.close,
      volume: this.config.volume,
    };
  }

  buildSeries(): PriceData[] {
    if (this.customCandles.length > 0) {
      return this.customCandles.map(candle => ({
        date: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? this.config.volume,
      }));
    }

    const tfMinutes = this.getTimeframeMinutes();
    const startTime = new Date(this.config.startDate).getTime();
    const candles: PriceData[] = [];

    for (let i = 0; i < this.config.count; i++) {
      const date = new Date(startTime + i * tfMinutes * 60 * 1000);
      const open = this.config.startPrice;
      const calculated = this.calculateCandleValues(open);

      candles.push({
        date: this.formatDate(date),
        open,
        high: calculated.high,
        low: calculated.low,
        close: calculated.close,
        volume: this.config.volume,
      });
    }

    return candles;
  }

  private calculateCandleValues(open: number): { high: number; low: number; close: number } {
    const { type, percent } = this.config;

    if (type === 'doji') {
      return {
        high: open * 1.001,
        low: open * 0.999,
        close: open,
      };
    }

    const factor = type === 'green' ? 1 : -1;
    const change = (percent / 100) * factor;

    const close = open * (1 + change);
    const high = type === 'green'
      ? close * 1.01
      : open * 1.01;
    const low = type === 'green'
      ? open * 0.99
      : close * 0.99;

    return { high, low, close };
  }

  private getTimeframeMinutes(): number {
    const minutesMap: Record<Timeframe, number> = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1D': 1440,
      '1W': 10080,
    };
    return minutesMap[this.config.timeframe];
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace('.000Z', 'Z');
  }
}
