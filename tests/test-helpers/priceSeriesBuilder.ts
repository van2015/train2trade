import { PriceData } from '../../src/shared/types/asset';
import { SamplePriceBuilder } from './samplePriceBuilder';

interface CandleDraft {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export class PriceSeriesBuilder {
  private readonly builder = new SamplePriceBuilder();
  private draft?: CandleDraft;

  inert(date: string, price = 100): this {
    this.flush();
    this.builder.add(date, price, price, price, price);
    return this;
  }

  at(date: string): this {
    this.flush();
    this.draft = { date };
    return this;
  }

  open(value: number): this {
    this.current().open = value;
    return this;
  }

  high(value: number): this {
    this.current().high = value;
    return this;
  }

  low(value: number): this {
    this.current().low = value;
    return this;
  }

  close(value: number): this {
    this.current().close = value;
    return this;
  }

  volume(value: number): this {
    this.current().volume = value;
    return this;
  }

  build(): PriceData[] {
    this.flush();
    return this.builder.buildSeries();
  }

  private current(): CandleDraft {
    if (!this.draft) throw new Error('Call at(date) before setting candle values');
    return this.draft;
  }

  private flush(): void {
    if (!this.draft) return;
    const { date, volume } = this.draft;
    const close = this.draft.close ?? this.draft.open;
    const open = this.draft.open ?? this.draft.close;
    if (open === undefined || close === undefined) {
      throw new Error(`Candle ${date} needs at least an open or a close`);
    }
    const high = this.draft.high ?? Math.max(open, close);
    const low = this.draft.low ?? Math.min(open, close);
    this.builder.add(date, open, high, low, close, volume);
    this.draft = undefined;
  }
}
