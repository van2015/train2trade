import { EquityPoint } from '../../src/backtest/types/backtest';

export class EquityPointBuilder {
  private points: EquityPoint[] = [];

  static series(values: number[], startTime = 0): EquityPoint[] {
    return values.map((equity, index) => ({
      time: startTime + index,
      balance: equity,
      equity,
    }));
  }

  point(time: number, equity: number, balance: number = equity): this {
    this.points.push({ time, equity, balance });
    return this;
  }

  build(): EquityPoint[] {
    return this.points.map(point => ({ ...point }));
  }
}
