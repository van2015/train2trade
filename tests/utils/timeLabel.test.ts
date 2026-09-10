import { describe, it, expect } from 'vitest';
import { createTimeLabelFormatter } from '../../src/utils/timeLabel';
import { Timeframe } from '../../src/timeframe/Timeframe';

const T = Date.UTC(2024, 0, 1, 10, 30) / 1000;

function format(timeframe: Timeframe): string {
  return createTimeLabelFormatter(timeframe, 'en-GB')(T);
}

describe('createTimeLabelFormatter', () => {
  it('1m shows date, hour and minutes', () => {
    const out = format('1m');
    expect(out).toContain('2024');
    expect(out).toContain('10:30');
  });

  it('5m and 15m also show minutes', () => {
    expect(format('5m')).toContain('10:30');
    expect(format('15m')).toContain('10:30');
  });

  it('1h shows date and hour without minutes', () => {
    const out = format('1h');
    expect(out).toContain('2024');
    expect(out).toContain('10');
    expect(out).not.toContain(':30');
  });

  it('4h shows date and hour without minutes', () => {
    const out = format('4h');
    expect(out).toContain('2024');
    expect(out).not.toContain(':30');
  });

  it('1D shows only the date', () => {
    const out = format('1D');
    expect(out).toContain('2024');
    expect(out).not.toContain(':');
  });

  it('1W shows only the date', () => {
    expect(format('1W')).not.toContain(':');
  });
});
