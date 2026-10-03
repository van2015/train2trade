import { describe, it, expect } from 'vitest';
import { Trade } from '../../src/backtest/models/Trade';
import { TradeState, Side } from '../../src/backtest/types/TradeEnums';
import { PriceData } from '../../src/shared/types/asset';

const bar = (over: Partial<PriceData> = {}): PriceData => ({
  date: '2024-01-01T00:00:00Z',
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 1000,
  ...over,
});

describe('Trade', () => {
  describe('open and addSize', () => {
    it('open(price, size) opens the trade', () => {
      const trade = new Trade('p1', Side.Long);

      trade.open(100, 1);

      expect(trade.state).toBe(TradeState.Open);
      expect(trade.size).toBe(1);
      expect(trade.averageEntry).toBe(100);
    });

    it('addSize(size) adds size to an open trade', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      trade.addSize(1);

      expect(trade.size).toBe(2);
      expect(trade.averageEntry).toBe(100);
    });

    it('addSize at current markPrice averages the entry price', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);
      trade.processCandle(bar({ close: 110 }));

      trade.addSize(1);

      expect(trade.size).toBe(2);
      expect(trade.averageEntry).toBeCloseTo(105);
    });

    it('addSize with different size averages the entry price correctly', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);
      trade.processCandle(bar({ close: 110 }));

      trade.addSize(3);

      expect(trade.size).toBe(4);
      expect(trade.averageEntry).toBeCloseTo(107.5);
    });

    it('addSize(size) rejects size <= 0', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      const r1 = trade.addSize(0);
      expect(r1.success).toBe(false);
      expect(!r1.success && r1.error.type).toBe('INVALID_SIZE');

      const r2 = trade.addSize(-1);
      expect(r2.success).toBe(false);
      expect(!r2.success && r2.error.type).toBe('INVALID_SIZE');
    });

    it('addSize on a pending trade fails', () => {
      const trade = new Trade('p1', Side.Long);

      const result = trade.addSize(1);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('TRADE_NOT_OPEN');
    });
  });

  describe('unrealized PnL', () => {
    it('unrealizedPnlPercent for long position', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      trade.processCandle(bar({ close: 108 }));

      const result = trade.unrealizedPnlPercent;
      expect(result.success).toBe(true);
      expect(result.success && result.value).toBeCloseTo(8);
    });

    it('unrealizedPnl for long position', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);

      trade.processCandle(bar({ close: 105 }));

      const result = trade.unrealizedPnl;
      expect(result.success).toBe(true);
      expect(result.success && result.value).toBeCloseTo(10);
    });

    it('unrealizedPnlPercent for short position', () => {
      const trade = new Trade('p1', Side.Short);
      trade.open(100, 1);

      trade.processCandle(bar({ close: 95 }));

      const result = trade.unrealizedPnlPercent;
      expect(result.success).toBe(true);
      expect(result.success && result.value).toBeCloseTo(5);
    });

    it('unrealizedPnlPercent returns error if no processCandle was called', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      const result = trade.unrealizedPnlPercent;
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('MARK_PRICE_NOT_SET');
    });

    it('unrealizedPnl returns error if no processCandle was called', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      const result = trade.unrealizedPnl;
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('MARK_PRICE_NOT_SET');
    });

    it('processCandle updates markPrice', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);

      trade.processCandle(bar({ close: 108 }));

      expect(trade.markPrice).toBe(108);
    });
  });

  describe('processCandle - stop loss', () => {
    it('long: bar.low hits stopLoss, closes that size', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addStopLoss(95, 1);

      trade.processCandle(bar({ high: 100, low: 90, close: 92 }));

      expect(trade.size).toBe(1);
      expect(trade.state).toBe(TradeState.Open);
      expect(trade.realizedPnlPercent).toBeCloseTo(-5);
      expect(trade.getStopLosses()).toHaveLength(0);
    });

    it('long: SL triggers and closes entire position', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);
      trade.addStopLoss(95, 1);

      trade.processCandle(bar({ high: 98, low: 90, close: 92 }));

      expect(trade.state).toBe(TradeState.Closed);
      expect(trade.size).toBe(0);
      expect(trade.realizedPnlPercent).toBeCloseTo(-5);
    });

    it('short: bar.high hits stopLoss', () => {
      const trade = new Trade('p1', Side.Short);
      trade.open(100, 1);
      trade.addStopLoss(105, 1);

      trade.processCandle(bar({ high: 108, low: 95, close: 106 }));

      expect(trade.state).toBe(TradeState.Closed);
      expect(trade.realizedPnlPercent).toBeCloseTo(-5);
    });

    it('multiple SLs: closes only the triggered one', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 3);
      trade.addStopLoss(95, 1);
      trade.addStopLoss(90, 1);

      trade.processCandle(bar({ high: 96, low: 93, close: 94 }));

      expect(trade.size).toBe(2);
      expect(trade.realizedPnlPercent).toBeCloseTo(-5);
      expect(trade.getStopLosses()).toHaveLength(1);
      expect(trade.getStopLosses()[0]).toEqual({ price: 90, size: 1 });
    });

    it('SL not triggered when bar.low is above stopLoss', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addStopLoss(95, 1);

      trade.processCandle(bar({ high: 110, low: 96, close: 105 }));

      expect(trade.size).toBe(2);
      expect(trade.realizedPnlPercent).toBe(0);
      expect(trade.getStopLosses()).toHaveLength(1);
    });
  });

  describe('processCandle - take profit', () => {
    it('long: bar.high hits takeProfit, closes that size', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addTakeProfit(110, 1);

      trade.processCandle(bar({ high: 115, low: 105, close: 112 }));

      expect(trade.size).toBe(1);
      expect(trade.state).toBe(TradeState.Open);
      expect(trade.realizedPnlPercent).toBeCloseTo(10);
      expect(trade.getTakeProfits()).toHaveLength(0);
    });

    it('long: TP triggers and closes entire position', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);
      trade.addTakeProfit(110, 1);

      trade.processCandle(bar({ high: 115, low: 105, close: 112 }));

      expect(trade.state).toBe(TradeState.Closed);
      expect(trade.size).toBe(0);
      expect(trade.realizedPnlPercent).toBeCloseTo(10);
    });

    it('short: bar.low hits takeProfit', () => {
      const trade = new Trade('p1', Side.Short);
      trade.open(100, 1);
      trade.addTakeProfit(90, 1);

      trade.processCandle(bar({ high: 98, low: 85, close: 88 }));

      expect(trade.state).toBe(TradeState.Closed);
      expect(trade.realizedPnlPercent).toBeCloseTo(10);
    });

    it('TP not triggered when bar.high is below takeProfit', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addTakeProfit(110, 1);

      trade.processCandle(bar({ high: 108, low: 100, close: 105 }));

      expect(trade.size).toBe(2);
      expect(trade.getTakeProfits()).toHaveLength(1);
    });
  });

  describe('processCandle - both SL and TP hit in same candle', () => {
    it('returns error if both SL and TP conditions are met', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addStopLoss(95, 1);
      trade.addTakeProfit(110, 1);

      const result = trade.processCandle(bar({ high: 115, low: 90, close: 100 }));

      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('AMBIGUOUS_CANDLE');
    });

    it('returns error for short when both SL and TP hit', () => {
      const trade = new Trade('p1', Side.Short);
      trade.open(100, 2);
      trade.addStopLoss(105, 1);
      trade.addTakeProfit(90, 1);

      const result = trade.processCandle(bar({ high: 110, low: 85, close: 100 }));

      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('AMBIGUOUS_CANDLE');
    });
  });

  describe('close and closeAll', () => {
    it('close(size) closes specified size at markPrice', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);

      trade.processCandle(bar({ close: 110 }));
      trade.close(3);

      expect(trade.size).toBe(2);
      expect(trade.state).toBe(TradeState.Open);
      expect(trade.realizedPnlPercent).toBeCloseTo(30);
    });

    it('closeAll() closes entire position at markPrice', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 3);

      trade.processCandle(bar({ close: 110 }));
      trade.closeAll();

      expect(trade.size).toBe(0);
      expect(trade.state).toBe(TradeState.Closed);
      expect(trade.realizedPnlPercent).toBeCloseTo(30);
    });

    it('close(size) rejects size <= 0', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.processCandle(bar({ close: 110 }));

      const r1 = trade.close(0);
      expect(r1.success).toBe(false);
      expect(!r1.success && r1.error.type).toBe('INVALID_SIZE');

      const r2 = trade.close(-1);
      expect(r2.success).toBe(false);
      expect(!r2.success && r2.error.type).toBe('INVALID_SIZE');
    });

    it('close(size) rejects size larger than position', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.processCandle(bar({ close: 110 }));

      const result = trade.close(3);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('CLOSE_SIZE_EXCEEDS_POSITION');
    });

    it('close fails if trade is not open', () => {
      const trade = new Trade('p1', Side.Long);

      const result = trade.close(1);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('TRADE_NOT_OPEN');
    });

    it('short: closeAll computes negative-direction PnL', () => {
      const trade = new Trade('p1', Side.Short);
      trade.open(100, 1);

      trade.processCandle(bar({ close: 95 }));
      trade.closeAll();

      expect(trade.realizedPnlPercent).toBeCloseTo(5);
      expect(trade.state).toBe(TradeState.Closed);
    });

    it('trade cannot be modified after closeAll', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 1);
      trade.processCandle(bar({ close: 110 }));
      trade.closeAll();

      const r1 = trade.addSize(1);
      expect(r1.success).toBe(false);
      expect(!r1.success && r1.error.type).toBe('TRADE_CLOSED');

      const r2 = trade.addStopLoss(95, 1);
      expect(r2.success).toBe(false);
      expect(!r2.success && r2.error.type).toBe('TRADE_CLOSED');

      const r3 = trade.close(1);
      expect(r3.success).toBe(false);
      expect(!r3.success && r3.error.type).toBe('TRADE_CLOSED');
    });
  });

  describe('getStopLosses and getTakeProfits', () => {
    it('getStopLosses returns all configured stop losses', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addStopLoss(95, 2);
      trade.addStopLoss(90, 1);

      const sl = trade.getStopLosses();
      expect(sl).toHaveLength(2);
      expect(sl[0]).toEqual({ price: 95, size: 2 });
      expect(sl[1]).toEqual({ price: 90, size: 1 });
    });

    it('getTakeProfits returns all configured take profits', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addTakeProfit(110, 2);
      trade.addTakeProfit(120, 1);

      const tp = trade.getTakeProfits();
      expect(tp).toHaveLength(2);
      expect(tp[0]).toEqual({ price: 110, size: 2 });
      expect(tp[1]).toEqual({ price: 120, size: 1 });
    });

    it('returns empty array when no SL/TP configured', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);

      expect(trade.getStopLosses()).toHaveLength(0);
      expect(trade.getTakeProfits()).toHaveLength(0);
    });
  });

  describe('updateStopLoss and updateTakeProfit', () => {
    it('updateStopLoss modifies size of existing SL', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addStopLoss(95, 2);

      trade.updateStopLoss(0, 3);

      expect(trade.getStopLosses()[0]).toEqual({ price: 95, size: 3 });
    });

    it('updateStopLoss with size=0 removes the SL', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addStopLoss(95, 2);
      trade.addStopLoss(90, 1);

      trade.updateStopLoss(0, 0);

      expect(trade.getStopLosses()).toHaveLength(1);
      expect(trade.getStopLosses()[0]).toEqual({ price: 90, size: 1 });
    });

    it('updateTakeProfit modifies size of existing TP', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addTakeProfit(110, 2);

      trade.updateTakeProfit(0, 1);

      expect(trade.getTakeProfits()[0]).toEqual({ price: 110, size: 1 });
    });

    it('updateTakeProfit with size=0 removes the TP', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addTakeProfit(110, 2);
      trade.addTakeProfit(120, 1);

      trade.updateTakeProfit(0, 0);

      expect(trade.getTakeProfits()).toHaveLength(1);
      expect(trade.getTakeProfits()[0]).toEqual({ price: 120, size: 1 });
    });

    it('updateStopLoss fails for out-of-range index', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);
      trade.addStopLoss(95, 1);

      const result = trade.updateStopLoss(1, 2);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('INVALID_INDEX');
    });

    it('addStopLoss with negative size fails', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 5);

      const result = trade.addStopLoss(95, -1);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.type).toBe('INVALID_STOP_LOSS_SIZE');
    });
  });

  describe('toView', () => {
    it('toView returns trade view with current values', () => {
      const trade = new Trade('p1', Side.Long);
      trade.open(100, 2);
      trade.addStopLoss(95, 2);
      trade.addTakeProfit(120, 2);
      trade.processCandle(bar({ high: 115, low: 96, close: 105 }));

      const view = trade.toView();

      expect(view.id).toBe('p1');
      expect(view.side).toBe(Side.Long);
      expect(view.state).toBe(TradeState.Open);
      expect(view.size).toBe(2);
      expect(view.averageEntry).toBe(100);
      expect(view.stopLoss).toBe(95);
      expect(view.takeProfit).toBe(120);
      expect(view.realizedPnl).toBe(0);
      expect(view.rMultiple).toBe(0);
    });
  });
});
