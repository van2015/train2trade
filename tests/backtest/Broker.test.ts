import { describe, it, expect } from 'vitest';
import { Broker } from '../../src/backtest/services/Broker';
import { PlatformConfigBuilder } from '../test-helpers/platformConfigBuilder';

const config = new PlatformConfigBuilder()
  .withContractSize(1)
  .withMinLot(0.1)
  .withLotStep(0.1)
  .withTickSize(0.1)
  .withLeverage(100)
  .withCommissionPerLot(5)
  .withSpread(0.2)
  .withSlippage(0.1)
  .withStopOutLevel(0.5)
  .build();

function broker(): Broker {
  return new Broker(config, 10000);
}

describe('Broker sizing', () => {
  it('sizes from risk and the stop distance', () => {
    const result = broker().sizeFromRisk(0.01, 100, 90, 10000);

    expect(result.success).toBe(true);
    expect(result.success && result.value).toBeCloseTo(10);
  });

  it('rounds down to the lot step', () => {
    const result = broker().sizeFromRisk(0.0005, 100, 90, 10000);

    expect(result.success).toBe(true);
    expect(result.success && result.value).toBeCloseTo(0.5);
  });

  it('returns zero when the risk-based size is below the minimum lot', () => {
    const result = broker().sizeFromRisk(0.000001, 100, 90, 10000);

    expect(result.success).toBe(true);
    expect(result.success && result.value).toBe(0);
  });

  it('rejects risk-based sizing without a stop', () => {
    const result = broker().sizeFromRisk(0.01, 100, undefined, 10000);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('STOP_REQUIRED');
  });

  it('rejects risk-based sizing when the stop equals the entry', () => {
    const result = broker().sizeFromRisk(0.01, 100, 100, 10000);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('STOP_SAME_AS_ENTRY');
  });
});

describe('Broker order validation', () => {
  it('rejects prices that are not aligned to the tick size', () => {
    const result = broker().validateOrder({ price: 100.05, size: 0.5 });

    expect(result.valid).toBe(false);
  });

  it('accepts tick-aligned prices', () => {
    const result = broker().validateOrder({ price: 100.1, size: 0.5 });

    expect(result.valid).toBe(true);
  });

  it('rejects sizes that violate lot step or minimum', () => {
    expect(broker().validateOrder({ size: 0.05 }).valid).toBe(false);
    expect(broker().validateOrder({ size: 0.15 }).valid).toBe(false);
    expect(broker().validateOrder({ size: 0.3 }).valid).toBe(true);
  });

  it('aligns prices and sizes', () => {
    expect(broker().alignToTick(100.07)).toBeCloseTo(100.1);
    expect(broker().alignSize(0.17)).toBeCloseTo(0.1);
  });
});

describe('Broker costs', () => {
  it('applies spread and slippage to buy and sell fills', () => {
    expect(broker().fillPrice('buy', 100)).toBeCloseTo(100.2);
    expect(broker().fillPrice('sell', 100)).toBeCloseTo(99.8);
  });

  it('omits slippage when requested', () => {
    expect(broker().fillPrice('buy', 100, false)).toBeCloseTo(100.1);
  });

  it('computes commission from size', () => {
    expect(broker().commission(2)).toBeCloseTo(10);
  });
});

describe('Broker margin and stop-out', () => {
  it('tracks required margin', () => {
    const b = broker();
    b.addMargin(2, 100);

    expect(b.marginRequired(2, 100)).toBeCloseTo(2);
    expect(b.margin).toBeCloseTo(2);

    b.releaseMargin(2, 100);
    expect(b.margin).toBeCloseTo(0);
  });

  it('triggers a stop-out at or below the threshold', () => {
    const b = broker();
    b.addMargin(100, 100);

    expect(b.isStopOut(50)).toBe(true);
    expect(b.isStopOut(60)).toBe(false);
  });

  it('does not trigger a stop-out without margin', () => {
    expect(broker().isStopOut(0)).toBe(false);
  });

  it('applies realized PnL to the balance', () => {
    const b = broker();
    b.applyRealizedPnl(250);

    expect(b.balance).toBeCloseTo(10250);
  });
});
