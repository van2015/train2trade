import { describe, expect, it } from 'vitest';
import { getConditionIndicatorOptions } from '../../src/strategy/ConditionIndicatorCatalog';

describe('ConditionIndicatorCatalog', () => {
  it('offers close, open, high, low and every technical indicator of the app', () => {
    const options = getConditionIndicatorOptions();

    expect(options.map((option) => option.id)).toEqual([
      'close',
      'open',
      'high',
      'low',
      'sma',
      'ema',
      'bb',
      'rsi',
      'macd',
      'volume',
    ]);
    expect(options.map((option) => option.label)).toEqual([
      'Close',
      'Open',
      'High',
      'Low',
      'SMA',
      'EMA',
      'Bollinger Bands',
      'RSI',
      'MACD',
      'Volume',
    ]);
    expect(options.find((option) => option.id === 'rsi')?.params).toEqual([
      { key: 'period', label: 'Period', default: 14, min: 1 },
    ]);
  });
});
