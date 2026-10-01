import {
  IndicatorDefinition,
  IndicatorId,
  IndicatorInstance,
  IndicatorPlot,
  IndicatorPlotPoint,
  IndicatorSeries,
  PriceData,
} from '../../shared/types/asset';
import { Timeframe } from '../timeframe/Timeframe';

type Values = (number | undefined)[];

const COLORS = {
  sma: '#2962FF',
  ema: '#FF6D00',
  bbBand: '#7E57C2',
  bbMiddle: '#FFB300',
  rsi: '#7E57C2',
  macd: '#2962FF',
  signal: '#FF6D00',
  up: '#26a69a',
  down: '#ef5350',
  volume: '#90A4AE',
};

export class IndicatorCalculator {
  private toTime(date: string): number {
    return Math.floor(new Date(date).getTime() / 1000);
  }

  sma(values: number[], period: number): Values {
    const result: Values = new Array(values.length).fill(undefined);
    if (period <= 0) return result;

    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) result[i] = sum / period;
    }
    return result;
  }

  ema(values: number[], period: number): Values {
    const result: Values = new Array(values.length).fill(undefined);
    if (period <= 0 || values.length < period) return result;

    const alpha = 2 / (period + 1);
    let previous = 0;
    for (let i = 0; i < period; i++) previous += values[i];
    previous /= period;
    result[period - 1] = previous;

    for (let i = period; i < values.length; i++) {
      previous = values[i] * alpha + previous * (1 - alpha);
      result[i] = previous;
    }
    return result;
  }

  bollinger(
    values: number[],
    period: number,
    stdDev: number
  ): { middle: Values; upper: Values; lower: Values } {
    const middle = this.sma(values, period);
    const upper: Values = new Array(values.length).fill(undefined);
    const lower: Values = new Array(values.length).fill(undefined);

    if (period <= 0) return { middle, upper, lower };

    for (let i = period - 1; i < values.length; i++) {
      const mean = middle[i];
      if (mean === undefined) continue;
      let sumSquares = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSquares += (values[j] - mean) ** 2;
      }
      const deviation = Math.sqrt(sumSquares / period);
      upper[i] = mean + stdDev * deviation;
      lower[i] = mean - stdDev * deviation;
    }

    return { middle, upper, lower };
  }

  rsi(values: number[], period: number): Values {
    const result: Values = new Array(values.length).fill(undefined);
    if (period <= 0 || values.length <= period) return result;

    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];
      if (change >= 0) gain += change;
      else loss -= change;
    }

    let avgGain = gain / period;
    let avgLoss = loss / period;
    result[period] = this.rsiValue(avgGain, avgLoss);

    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
      result[i] = this.rsiValue(avgGain, avgLoss);
    }

    return result;
  }

  private rsiValue(avgGain: number, avgLoss: number): number {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  macd(
    values: number[],
    fast: number,
    slow: number,
    signal: number
  ): { macdLine: Values; signalLine: Values; histogram: Values } {
    const fastEma = this.ema(values, fast);
    const slowEma = this.ema(values, slow);

    const macdLine: Values = values.map((_, i) =>
      fastEma[i] !== undefined && slowEma[i] !== undefined
        ? (fastEma[i] as number) - (slowEma[i] as number)
        : undefined
    );

    const signalLine: Values = new Array(values.length).fill(undefined);
    const histogram: Values = new Array(values.length).fill(undefined);

    const firstIndex = macdLine.findIndex(value => value !== undefined);
    if (firstIndex >= 0) {
      const defined = macdLine.slice(firstIndex) as number[];
      const signalEma = this.ema(defined, signal);
      for (let i = 0; i < signalEma.length; i++) {
        const value = signalEma[i];
        if (value === undefined) continue;
        signalLine[firstIndex + i] = value;
        histogram[firstIndex + i] = defined[i] - value;
      }
    }

    return { macdLine, signalLine, histogram };
  }

  toPlotPoints(
    candles: PriceData[],
    values: Values,
    colorForPoint?: (value: number, index: number, candle: PriceData) => string
  ): IndicatorPlotPoint[] {
    return candles.map((candle, index) => {
      const time = this.toTime(candle.date);
      const value = values[index];
      if (value === undefined) return { time };
      if (colorForPoint) return { time, value, color: colorForPoint(value, index, candle) };
      return { time, value };
    });
  }
}

const smaDefinition: IndicatorDefinition = {
  id: 'sma',
  label: 'SMA',
  pane: 'overlay',
  params: [{ key: 'period', label: 'Period', default: 20, min: 1 }],
  lookback: params => params.period,
  series: [
    {
      key: 'sma',
      label: params => `SMA(${params.period})`,
      style: 'line',
      color: COLORS.sma,
      computeValues: (candles, params) =>
        new IndicatorCalculator().sma(candles.map(candle => candle.close), params.period),
    },
  ],
};

const emaDefinition: IndicatorDefinition = {
  id: 'ema',
  label: 'EMA',
  pane: 'overlay',
  params: [{ key: 'period', label: 'Period', default: 20, min: 1 }],
  lookback: params => params.period * 3,
  series: [
    {
      key: 'ema',
      label: params => `EMA(${params.period})`,
      style: 'line',
      color: COLORS.ema,
      computeValues: (candles, params) =>
        new IndicatorCalculator().ema(candles.map(candle => candle.close), params.period),
    },
  ],
};

const bollingerDefinition: IndicatorDefinition = {
  id: 'bb',
  label: 'Bollinger Bands',
  pane: 'overlay',
  params: [
    { key: 'period', label: 'Period', default: 20, min: 1 },
    { key: 'stdDev', label: 'Std Dev', default: 2, min: 0 },
  ],
  lookback: params => params.period,
  series: [
    {
      key: 'upper',
      label: () => 'BB Upper',
      style: 'line',
      color: COLORS.bbBand,
      computeValues: (candles, params) =>
        new IndicatorCalculator().bollinger(
          candles.map(candle => candle.close),
          params.period,
          params.stdDev
        ).upper,
    },
    {
      key: 'middle',
      label: () => 'BB Middle',
      style: 'line',
      color: COLORS.bbMiddle,
      computeValues: (candles, params) =>
        new IndicatorCalculator().bollinger(
          candles.map(candle => candle.close),
          params.period,
          params.stdDev
        ).middle,
    },
    {
      key: 'lower',
      label: () => 'BB Lower',
      style: 'line',
      color: COLORS.bbBand,
      computeValues: (candles, params) =>
        new IndicatorCalculator().bollinger(
          candles.map(candle => candle.close),
          params.period,
          params.stdDev
        ).lower,
    },
  ],
};

const rsiDefinition: IndicatorDefinition = {
  id: 'rsi',
  label: 'RSI',
  pane: 'separate',
  params: [{ key: 'period', label: 'Period', default: 14, min: 1 }],
  lookback: params => params.period + 1,
  series: [
    {
      key: 'rsi',
      label: params => `RSI(${params.period})`,
      style: 'line',
      color: COLORS.rsi,
      computeValues: (candles, params) =>
        new IndicatorCalculator().rsi(candles.map(candle => candle.close), params.period),
    },
  ],
};

const macdDefinition: IndicatorDefinition = {
  id: 'macd',
  label: 'MACD',
  pane: 'separate',
  params: [
    { key: 'fast', label: 'Fast', default: 12, min: 1 },
    { key: 'slow', label: 'Slow', default: 26, min: 1 },
    { key: 'signal', label: 'Signal', default: 9, min: 1 },
  ],
  lookback: params => params.slow + params.signal,
  series: [
    {
      key: 'macd',
      label: () => 'MACD',
      style: 'line',
      color: COLORS.macd,
      computeValues: (candles, params) =>
        new IndicatorCalculator().macd(
          candles.map(candle => candle.close),
          params.fast,
          params.slow,
          params.signal
        ).macdLine,
    },
    {
      key: 'signal',
      label: () => 'Signal',
      style: 'line',
      color: COLORS.signal,
      computeValues: (candles, params) =>
        new IndicatorCalculator().macd(
          candles.map(candle => candle.close),
          params.fast,
          params.slow,
          params.signal
        ).signalLine,
    },
    {
      key: 'histogram',
      label: () => 'Histogram',
      style: 'histogram',
      color: COLORS.volume,
      colorForValue: value => (value >= 0 ? COLORS.up : COLORS.down),
      computeValues: (candles, params) =>
        new IndicatorCalculator().macd(
          candles.map(candle => candle.close),
          params.fast,
          params.slow,
          params.signal
        ).histogram,
    },
  ],
};

const volumeDefinition: IndicatorDefinition = {
  id: 'volume',
  label: 'Volume',
  pane: 'separate',
  params: [],
  lookback: () => 0,
  series: [
    {
      key: 'volume',
      label: () => 'Volume',
      style: 'histogram',
      color: COLORS.volume,
      colorForValue: (_value, _index, candle) =>
        candle.close >= candle.open ? COLORS.up : COLORS.down,
      computeValues: candles => candles.map(candle => candle.volume),
    },
  ],
};

export const INDICATOR_DEFINITIONS: IndicatorDefinition[] = [
  smaDefinition,
  emaDefinition,
  bollingerDefinition,
  rsiDefinition,
  macdDefinition,
  volumeDefinition,
];

export class IndicatorDefinitionRegistry {
  private definitionsById = new Map<IndicatorId, IndicatorDefinition>(
    INDICATOR_DEFINITIONS.map(definition => [definition.id, definition])
  );

  getDefinition(id: IndicatorId): IndicatorDefinition | undefined {
    return this.definitionsById.get(id);
  }

  normalizeParams(
    definition: IndicatorDefinition,
    params: Record<string, number>
  ): Record<string, number> {
    const normalized: Record<string, number> = {};
    for (const spec of definition.params) {
      const value = params?.[spec.key];
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : spec.default;
      normalized[spec.key] = spec.min !== undefined ? Math.max(spec.min, numeric) : numeric;
    }
    return normalized;
  }

  getIndicatorGroups(): {
    overlays: IndicatorDefinition[];
    oscillators: IndicatorDefinition[];
  } {
    return {
      overlays: INDICATOR_DEFINITIONS.filter(definition => definition.pane === 'overlay'),
      oscillators: INDICATOR_DEFINITIONS.filter(definition => definition.pane === 'separate'),
    };
  }
}

function newInstanceKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `indicator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class IndicatorEngine {
  private registry = new IndicatorDefinitionRegistry();
  private calculator = new IndicatorCalculator();

  createIndicatorInstance(id: IndicatorId): IndicatorInstance | null {
    const definition = this.registry.getDefinition(id);
    if (!definition) return null;
    return {
      key: newInstanceKey(),
      indicatorId: definition.id,
      params: this.registry.normalizeParams(definition, {}),
    };
  }

  compute(instance: IndicatorInstance, candles: PriceData[]): IndicatorPlot[] {
    const definition = this.registry.getDefinition(instance.indicatorId);
    if (!definition) return [];
    const params = this.registry.normalizeParams(definition, instance.params);
    const series = this.computeSeries(instance, candles);
    return definition.series.map((spec, index) => ({
      key: spec.key,
      label: spec.label(params),
      style: spec.style,
      color: spec.color,
      data: this.calculator.toPlotPoints(candles, series[index].values, spec.colorForValue),
    }));
  }

  computeSeries(instance: IndicatorInstance, candles: PriceData[]): IndicatorSeries[] {
    const definition = this.registry.getDefinition(instance.indicatorId);
    if (!definition) return [];
    const params = this.registry.normalizeParams(definition, instance.params);
    return definition.series.map(spec => ({
      key: spec.key,
      values: spec.computeValues(candles, params),
    }));
  }

  maxLookback(instances: IndicatorInstance[], timeframe: Timeframe): number {
    let candles = 0;
    for (const instance of instances) {
      const definition = this.registry.getDefinition(instance.indicatorId);
      if (!definition) continue;
      const lookback = definition.lookback(this.registry.normalizeParams(definition, instance.params));
      if (lookback > candles) candles = lookback;
    }
    if (candles <= 0) return 0;

    const margin = 2;
    return (candles + margin) * Timeframe.getMinutes(timeframe) * 60 * 1000;
  }
}

const globalEngine = new IndicatorEngine();

export function getDefinition(id: IndicatorId): IndicatorDefinition | undefined {
  return globalEngine['registry'].getDefinition(id);
}

export function normalizeParams(
  definition: IndicatorDefinition,
  params: Record<string, number>
): Record<string, number> {
  return globalEngine['registry'].normalizeParams(definition, params);
}

export function createIndicatorInstance(id: IndicatorId): IndicatorInstance | null {
  return globalEngine.createIndicatorInstance(id);
}

export function getIndicatorGroups(): {
  overlays: IndicatorDefinition[];
  oscillators: IndicatorDefinition[];
} {
  return globalEngine['registry'].getIndicatorGroups();
}

export function compute(instance: IndicatorInstance, candles: PriceData[]): IndicatorPlot[] {
  return globalEngine.compute(instance, candles);
}

export function computeSeries(instance: IndicatorInstance, candles: PriceData[]): IndicatorSeries[] {
  return globalEngine.computeSeries(instance, candles);
}

export function maxLookback(instances: IndicatorInstance[], timeframe: Timeframe): number {
  return globalEngine.maxLookback(instances, timeframe);
}
