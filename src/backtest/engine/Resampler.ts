import { PriceData } from '../../shared/types/asset';
import { ResampleResult } from '../../shared/types/backtest';
import { Timeframe } from '../../shared/timeframe/Timeframe';
import { TimeframeAggregator } from '../../shared/timeframe/TimeframeAggregator';

export class DataResampler {
  private aggregator = new TimeframeAggregator();

  resample(dataset: PriceData[], strategyTimeframe: Timeframe): ResampleResult {
    const sourceTimeframe = Timeframe.detect(dataset).tf;
    const sourceMinutes = Timeframe.getMinutes(sourceTimeframe);
    const targetMinutes = Timeframe.getMinutes(strategyTimeframe);

    if (dataset.length === 0) {
      return this.createEmptyResult(strategyTimeframe, sourceTimeframe);
    }

    this.validateTimeframeCombination(sourceTimeframe, sourceMinutes, targetMinutes);

    if (targetMinutes === sourceMinutes) {
      return this.createSingleTimeframeResult(dataset, strategyTimeframe, sourceTimeframe);
    }

    const result = this.aggregator.aggregateWithGaps(dataset, strategyTimeframe);

    return {
      strategyTimeframe,
      sourceTimeframe,
      bars: result.bars,
      subBars: result.subBars,
      hasFinerData: result.hasFinerData,
    };
  }

  private createEmptyResult(strategyTimeframe: Timeframe, sourceTimeframe: Timeframe): ResampleResult {
    return {
      strategyTimeframe,
      sourceTimeframe,
      bars: [],
      subBars: [],
      hasFinerData: false,
    };
  }

  private validateTimeframeCombination(sourceTimeframe: Timeframe, sourceMinutes: number, targetMinutes: number): void {
    if (targetMinutes < sourceMinutes) {
      throw new Error(
        `Cannot resample ${sourceTimeframe} data to a finer timeframe ${sourceTimeframe}`
      );
    }
  }

  private createSingleTimeframeResult(dataset: PriceData[], strategyTimeframe: Timeframe, sourceTimeframe: Timeframe): ResampleResult {
    const bars = dataset.map(candle => ({
      date: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      subBars: [candle],
    }));

    return {
      strategyTimeframe,
      sourceTimeframe,
      bars,
      subBars: dataset,
      hasFinerData: false,
    };
  }
}

export function resample(dataset: PriceData[], strategyTimeframe: Timeframe): ResampleResult {
  const resampler = new DataResampler();
  return resampler.resample(dataset, strategyTimeframe);
}
