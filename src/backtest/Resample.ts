import { PriceData } from '../types/asset';
import { AggregatedBar, ResampleResult } from '../types/backtest';
import { Timeframe } from '../timeframe/Timeframe';

export class DataResampler {
  private floorToBoundary(time: number, tfMinutes: number): number {
    const span = tfMinutes * 60 * 1000;
    return Math.floor(time / span) * span;
  }

  private formatDate(time: number): string {
    return new Date(time).toISOString().replace('.000Z', 'Z');
  }

  resample(dataset: PriceData[], strategyTimeframe: Timeframe): ResampleResult {
    const sourceTimeframe = Timeframe.detect(dataset).tf;
    const sourceMinutes = Timeframe.getMinutes(sourceTimeframe);
    const targetMinutes = Timeframe.getMinutes(strategyTimeframe);

    if (dataset.length === 0) {
      return {
        strategyTimeframe,
        sourceTimeframe,
        bars: [],
        subBars: [],
        hasFinerData: false,
      };
    }

    if (targetMinutes < sourceMinutes) {
      throw new Error(
        `Cannot resample ${sourceTimeframe} data to a finer timeframe ${strategyTimeframe}`
      );
    }

    if (targetMinutes === sourceMinutes) {
      const bars: AggregatedBar[] = dataset.map(candle => ({ ...candle, subBars: [candle] }));
      return {
        strategyTimeframe,
        sourceTimeframe,
        bars,
        subBars: dataset,
        hasFinerData: false,
      };
    }

    const targetSpan = targetMinutes * 60 * 1000;
    const gapEnds = new Set(Timeframe.detectGaps(dataset).map(gap => gap.endRow));
    const bars: AggregatedBar[] = [];
    let current: PriceData[] = [];
    let currentBoundary = -Infinity;

    const flush = () => {
      if (current.length === 0) return;
      const first = current[0];
      const last = current[current.length - 1];
      const boundary = this.floorToBoundary(new Date(first.date).getTime(), targetMinutes);
      const previousEnd =
        bars.length > 0 ? new Date(bars[bars.length - 1].date).getTime() + targetSpan : boundary;
      const date = Math.max(boundary, previousEnd);

      bars.push({
        date: this.formatDate(date),
        open: first.open,
        high: Math.max(...current.map(candle => candle.high)),
        low: Math.min(...current.map(candle => candle.low)),
        close: last.close,
        volume: current.reduce((sum, candle) => sum + candle.volume, 0),
        subBars: current,
      });
      current = [];
    };

    for (let i = 0; i < dataset.length; i++) {
      const candle = dataset[i];
      const boundary = this.floorToBoundary(new Date(candle.date).getTime(), targetMinutes);
      const startsNewGroup = current.length === 0 || boundary !== currentBoundary || gapEnds.has(i);

      if (startsNewGroup) {
        flush();
        currentBoundary = boundary;
      }

      current.push(candle);
    }

    flush();

    return {
      strategyTimeframe,
      sourceTimeframe,
      bars,
      subBars: dataset,
      hasFinerData: true,
    };
  }
}

export function resample(dataset: PriceData[], strategyTimeframe: Timeframe): ResampleResult {
  const resampler = new DataResampler();
  return resampler.resample(dataset, strategyTimeframe);
}
