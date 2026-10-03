import { PriceData } from '../../shared/types/asset';
import { ResampleResult, ResampleError } from '../../backtest/types/backtest';
import { Timeframe } from '../../backtest/timeframe/Timeframe';
import { TimeframeAggregator } from '../../backtest/timeframe/TimeframeAggregator';
import { Result } from '../../shared/types/Result';

export class DataResampler {
  private aggregator = new TimeframeAggregator();

  resample(dataset: PriceData[], strategyTimeframe: Timeframe): Result<ResampleResult, ResampleError> {
    const sourceTimeframe = Timeframe.detect(dataset).tf;
    const sourceMinutes = Timeframe.getMinutes(sourceTimeframe);
    const targetMinutes = Timeframe.getMinutes(strategyTimeframe);

    if (dataset.length === 0) {
      return { success: true, value: this.createEmptyResult(strategyTimeframe, sourceTimeframe) };
    }

    if (targetMinutes < sourceMinutes) {
      return {
        success: false,
        error: { type: 'INVALID_TIMEFRAME_COMBINATION', source: sourceTimeframe, target: strategyTimeframe },
      };
    }

    if (targetMinutes === sourceMinutes) {
      return { success: true, value: this.createSingleTimeframeResult(dataset, strategyTimeframe, sourceTimeframe) };
    }

    const result = this.aggregator.aggregateWithGaps(dataset, strategyTimeframe);

    return {
      success: true,
      value: {
        strategyTimeframe,
        sourceTimeframe,
        bars: result.bars,
        subBars: result.subBars,
        hasFinerData: result.hasFinerData,
      },
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

export function resample(dataset: PriceData[], strategyTimeframe: Timeframe): Result<ResampleResult, ResampleError> {
  const resampler = new DataResampler();
  return resampler.resample(dataset, strategyTimeframe);
}
