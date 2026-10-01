import { describe, it, expect } from 'vitest';
import { Interval } from '../../src/backtest/utils/Interval';

describe('Interval', () => {
  it('span returns the length', () => {
    expect(new Interval(100, 400).span).toBe(300);
  });

  it('contains checks if another interval is within', () => {
    const outer = new Interval(0, 1000);
    expect(outer.contains(new Interval(100, 900))).toBe(true);
    expect(outer.contains(new Interval(0, 1000))).toBe(true);
    expect(outer.contains(new Interval(-1, 500))).toBe(false);
    expect(outer.contains(new Interval(500, 1001))).toBe(false);
  });

  it('shift translates the interval', () => {
    expect(new Interval(100, 400).shift(50)).toEqual(new Interval(150, 450));
    expect(new Interval(100, 400).shift(-100)).toEqual(new Interval(0, 300));
  });

  it('union returns the smallest interval containing both', () => {
    const a = new Interval(100, 200);
    const b = new Interval(150, 400);
    expect(a.union(b)).toEqual(new Interval(100, 400));
    expect(b.union(a)).toEqual(new Interval(100, 400));
  });

  it('endingAt builds an interval of the given span ending at the point', () => {
    expect(Interval.endingAt(1000, 400)).toEqual(new Interval(600, 1000));
  });

  it('expand grows the interval by a ratio of its span on both sides', () => {
    const interval = new Interval(1000, 2000);
    expect(interval.expand(0.5)).toEqual(new Interval(500, 2500));
    expect(interval.expand(0)).toEqual(new Interval(1000, 2000));
  });

  it('startsBefore checks the lower bound', () => {
    const base = new Interval(1000, 2000);
    expect(new Interval(500, 2000).startsBefore(base)).toBe(true);
    expect(new Interval(1000, 2000).startsBefore(base)).toBe(false);
    expect(new Interval(1500, 2000).startsBefore(base)).toBe(false);
  });

  it('endsAfter checks the upper bound', () => {
    const base = new Interval(1000, 2000);
    expect(new Interval(1000, 3000).endsAfter(base)).toBe(true);
    expect(new Interval(1000, 2000).endsAfter(base)).toBe(false);
    expect(new Interval(1000, 1500).endsAfter(base)).toBe(false);
  });

  describe('movedTo', () => {
    it('shifts by the from delta when from moved', () => {
      const pre = new Interval(1000, 2000);
      const post = new Interval(800, 2000);
      expect(pre.movedTo(post)).toEqual(new Interval(800, 1800));
    });

    it('shifts by the to delta when only to moved (from clamped)', () => {
      const pre = new Interval(1000, 2000);
      const post = new Interval(1000, 1800);
      expect(pre.movedTo(post)).toEqual(new Interval(800, 1800));
    });

    it('returns null when nothing moved', () => {
      const pre = new Interval(1000, 2000);
      expect(pre.movedTo(new Interval(1000, 2000))).toBeNull();
    });
  });
});
