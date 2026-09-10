import { describe, it, expect } from 'vitest';
import { RangeStrategy } from '../../src/services/PriceRetrievalStrategy';
import { Interval } from '../../src/utils/Interval';

describe('RangeStrategy', () => {
  it('returns the requested range plus the default 20% buffer', async () => {
    const strategy = new RangeStrategy();

    const result = await strategy.getRange('asset1', new Interval(1000, 5000));

    expect(result.from).toBe(1000 - 4000 * 0.2);
    expect(result.to).toBe(5000 + 4000 * 0.2);
  });

  it('supports a configurable buffer ratio', async () => {
    const strategy = new RangeStrategy(1.0);

    const result = await strategy.getRange('asset1', new Interval(1000, 5000));

    expect(result.from).toBe(1000 - 4000);
    expect(result.to).toBe(5000 + 4000);
  });

  it('returns a raw window without clamping to dataset bounds', async () => {
    const strategy = new RangeStrategy();

    const result = await strategy.getRange('asset1', new Interval(1000, 5000));

    expect(result.from).toBeLessThan(1000);
    expect(result.to).toBeGreaterThan(5000);
  });
});
