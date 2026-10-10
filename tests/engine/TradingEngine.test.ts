import { describe, expect, it } from 'vitest';
import { TradingEngine } from '../../src/engine/TradingEngine';
import { PositionBuilder } from '../test-helpers/positionBuilder';
import { expectError, unwrap } from '../test-helpers/unwrap';

describe('TradingEngine', () => {
  it('opens a long position with the given price and size', () => {
    const engine = new TradingEngine();

    const position = unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    expect(position.side).toBe('long');
    expect(position.entryPrice).toBe(100);
    expect(position.size).toBe(1);
    expect(position.state).toBe('open');
  });

  it('rejects opening a position with a non-positive price', () => {
    const engine = new TradingEngine();

    const result = engine.open({ side: 'long', price: 0, size: 1 });

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_PRICE');
  });

  it('rejects opening a position with a non-positive size', () => {
    const engine = new TradingEngine();

    const result = engine.open({ side: 'long', price: 100, size: 0 });

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_SIZE');
  });

  it('tracks open positions after opening them', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    unwrap(engine.open({ side: 'short', price: 50, size: 1 }));

    expect(engine.openPositions).toHaveLength(2);
    expect(engine.openPositions.map((p) => p.entryPrice)).toEqual([100, 50]);

    const [first] = engine.openPositions;
    unwrap(engine.close(first, 110));

    expect(engine.openPositions).toHaveLength(1);
  });

  it('closes an open position with the exit price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().long().build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.state).toBe('closed');
    expect(closed.exitPrice).toBe(110);
    expect(position.state).toBe('open');
    expect(position.exitPrice).toBeUndefined();
  });

  it('rejects closing a position that is already closed', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().long().state('closed').build();

    const result = engine.close(position, 110);

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('POSITION_NOT_OPEN');
  });

  it('calculates PnL when closing a long position', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(100)
      .size(2)
      .build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.pnl).toBe(10);
  });

  it('expresses PnL as a percentage of the entry price', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder()
      .long()
      .entryPrice(100)
      .size(3)
      .build();

    const closed = unwrap(engine.close(position, 110));

    expect(closed.pnl).toBe(10);
  });

  it('calculates PnL for a short position (closing below entry gains)', () => {
    const engine = new TradingEngine();
    const position = new PositionBuilder().short().entryPrice(100).build();

    const closed = unwrap(engine.close(position, 90));

    expect(closed.pnl).toBe(10);
  });

  it('sums the PnL of closed positions into total PnL', () => {
    const engine = new TradingEngine();
    const long = unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    const short = unwrap(engine.open({ side: 'short', price: 100, size: 1 }));
    unwrap(engine.close(long, 110));
    unwrap(engine.close(short, 95));

    expect(engine.totalPnl).toBe(15);
  });

  it('rejects closing a position with a non-positive price', () => {
    const engine = new TradingEngine();
    const position = unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    const result = engine.close(position, 0);

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_PRICE');
    expect(position.state).toBe('open');
    expect(engine.totalPnl).toBe(0);
  });

  it('calculates unrealized PnL for open positions at a given price', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    unwrap(engine.open({ side: 'long', price: 200, size: 1 }));

    expect(engine.unrealizedPnl(110)).toBe(-35);
  });

  it('stores the stop loss when opening a position with one', () => {
    const engine = new TradingEngine();

    const withStop = unwrap(
      engine.open({ side: 'long', price: 100, size: 1, stopLoss: 95 })
    );
    const withoutStop = unwrap(
      engine.open({ side: 'long', price: 100, size: 1 })
    );

    expect(withStop.stopLoss).toBe(95);
    expect(withoutStop.stopLoss).toBeUndefined();
  });

  it('closes a long when the price reaches its stop loss', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1, stopLoss: 95 }));

    const stopped = engine.checkExits(94);

    expect(stopped).toHaveLength(1);
    expect(stopped[0].state).toBe('closed');
    expect(stopped[0].exitPrice).toBe(95);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.totalPnl).toBe(-5);
  });

  it('closes a short when the price reaches its stop loss', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'short', price: 100, size: 1, stopLoss: 105 }));

    const stopped = engine.checkExits(106);

    expect(stopped).toHaveLength(1);
    expect(stopped[0].state).toBe('closed');
    expect(stopped[0].exitPrice).toBe(105);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.totalPnl).toBe(-5);
  });

  it('stores the take profit when opening a position with one', () => {
    const engine = new TradingEngine();

    const withTp = unwrap(
      engine.open({ side: 'long', price: 100, size: 1, takeProfit: 120 })
    );
    const withoutTp = unwrap(
      engine.open({ side: 'long', price: 100, size: 1 })
    );

    expect(withTp.takeProfit).toBe(120);
    expect(withoutTp.takeProfit).toBeUndefined();
  });

  it('closes a long when the price reaches its take profit', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1, takeProfit: 120 }));

    const exited = engine.checkExits(125);

    expect(exited).toHaveLength(1);
    expect(exited[0].state).toBe('closed');
    expect(exited[0].exitPrice).toBe(120);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.totalPnl).toBe(20);
  });

  it('closes a short when the price reaches its take profit', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'short', price: 100, size: 1, takeProfit: 90 }));

    const exited = engine.checkExits(85);

    expect(exited).toHaveLength(1);
    expect(exited[0].state).toBe('closed');
    expect(exited[0].exitPrice).toBe(90);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.totalPnl).toBe(10);
  });

  it('rejects opening a long with a stop loss at or above the entry price', () => {
    const engine = new TradingEngine();

    const atEntry = engine.open({
      side: 'long',
      price: 100,
      size: 1,
      stopLoss: 100,
    });
    const aboveEntry = engine.open({
      side: 'long',
      price: 100,
      size: 1,
      stopLoss: 105,
    });

    expect(atEntry.success).toBe(false);
    expect(expectError(atEntry)).toBe('INVALID_STOP_LOSS');
    expect(aboveEntry.success).toBe(false);
    expect(expectError(aboveEntry)).toBe('INVALID_STOP_LOSS');
    expect(engine.openPositions).toHaveLength(0);
  });

  it('rejects opening a short with a stop loss at or below the entry price', () => {
    const engine = new TradingEngine();

    const atEntry = engine.open({
      side: 'short',
      price: 100,
      size: 1,
      stopLoss: 100,
    });
    const belowEntry = engine.open({
      side: 'short',
      price: 100,
      size: 1,
      stopLoss: 95,
    });

    expect(atEntry.success).toBe(false);
    expect(expectError(atEntry)).toBe('INVALID_STOP_LOSS');
    expect(belowEntry.success).toBe(false);
    expect(expectError(belowEntry)).toBe('INVALID_STOP_LOSS');
    expect(engine.openPositions).toHaveLength(0);
  });

  it('rejects opening a long with a take profit at or below the entry price', () => {
    const engine = new TradingEngine();

    const atEntry = engine.open({
      side: 'long',
      price: 100,
      size: 1,
      takeProfit: 100,
    });
    const belowEntry = engine.open({
      side: 'long',
      price: 100,
      size: 1,
      takeProfit: 95,
    });

    expect(atEntry.success).toBe(false);
    expect(expectError(atEntry)).toBe('INVALID_TAKE_PROFIT');
    expect(belowEntry.success).toBe(false);
    expect(expectError(belowEntry)).toBe('INVALID_TAKE_PROFIT');
    expect(engine.openPositions).toHaveLength(0);
  });

  it('rejects opening a short with a take profit at or above the entry price', () => {
    const engine = new TradingEngine();

    const atEntry = engine.open({
      side: 'short',
      price: 100,
      size: 1,
      takeProfit: 100,
    });
    const aboveEntry = engine.open({
      side: 'short',
      price: 100,
      size: 1,
      takeProfit: 105,
    });

    expect(atEntry.success).toBe(false);
    expect(expectError(atEntry)).toBe('INVALID_TAKE_PROFIT');
    expect(aboveEntry.success).toBe(false);
    expect(expectError(aboveEntry)).toBe('INVALID_TAKE_PROFIT');
    expect(engine.openPositions).toHaveLength(0);
  });

  it('closes all positions hit in the same tick', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1, stopLoss: 95 }));
    unwrap(engine.open({ side: 'long', price: 100, size: 1, stopLoss: 95 }));

    const exited = engine.checkExits(94);

    expect(exited).toHaveLength(2);
    expect(exited.map((p) => p.exitPrice)).toEqual([95, 95]);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.totalPnl).toBe(-10);
  });

  it('closes the long when the price exactly equals the stop loss', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1, stopLoss: 95 }));

    const exited = engine.checkExits(95);

    expect(exited).toHaveLength(1);
    expect(exited[0].exitPrice).toBe(95);
    expect(engine.totalPnl).toBe(-5);
  });

  it('closes the long when the price exactly equals the take profit', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1, takeProfit: 120 }));

    const exited = engine.checkExits(120);

    expect(exited).toHaveLength(1);
    expect(exited[0].exitPrice).toBe(120);
    expect(engine.totalPnl).toBe(20);
  });

  it('exposes closed positions as history', () => {
    const engine = new TradingEngine();
    const first = unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    unwrap(engine.close(first, 110));
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    expect(engine.closedPositions).toHaveLength(1);
    expect(engine.closedPositions[0].exitPrice).toBe(110);
    expect(engine.closedPositions[0].pnl).toBe(10);
    expect(engine.openPositions).toHaveLength(1);
  });

  it('closes every open position at the given price', () => {
    const engine = new TradingEngine();
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    const closed = engine.closeAll(110);

    expect(closed).toHaveLength(2);
    expect(closed.map((p) => p.exitPrice)).toEqual([110, 110]);
    expect(engine.openPositions).toHaveLength(0);
    expect(engine.closedPositions).toHaveLength(2);
    expect(engine.totalPnl).toBe(20);
  });

  it('combines realized and unrealized PnL into equity at a given price', () => {
    const engine = new TradingEngine();
    const closedOne = unwrap(
      engine.open({ side: 'long', price: 100, size: 1 })
    );
    unwrap(engine.close(closedOne, 110));
    unwrap(engine.open({ side: 'long', price: 100, size: 1 }));

    expect(engine.equity(110)).toBe(20);
  });

  it('places a limit order without opening a position', () => {
    const engine = new TradingEngine();

    const pending = unwrap(
      engine.placeLimitOrder({
        side: 'long',
        limitPrice: 95,
        size: 1,
        stopLoss: 90,
        takeProfit: 130,
      })
    );

    expect(pending.limitPrice).toBe(95);
    expect(pending.stopLoss).toBe(90);
    expect(pending.takeProfit).toBe(130);
    expect(engine.pendingOrders).toHaveLength(1);
    expect(engine.openPositions).toHaveLength(0);
  });

  it('rejects a limit order with a non-positive price', () => {
    const engine = new TradingEngine();

    const result = engine.placeLimitOrder({
      side: 'long',
      limitPrice: 0,
      size: 1,
    });

    expect(result.success).toBe(false);
    expect(expectError(result)).toBe('INVALID_PRICE');
    expect(engine.pendingOrders).toHaveLength(0);
  });

  it('fills a long limit order when price reaches it', () => {
    const engine = new TradingEngine();
    unwrap(
      engine.placeLimitOrder({
        side: 'long',
        limitPrice: 95,
        size: 1,
        stopLoss: 90,
        takeProfit: 130,
      })
    );

    const untouched = engine.checkEntries(96);
    expect(untouched).toHaveLength(0);
    expect(engine.pendingOrders).toHaveLength(1);

    const filled = engine.checkEntries(94);

    expect(filled).toHaveLength(1);
    expect(filled[0].entryPrice).toBe(95);
    expect(filled[0].stopLoss).toBe(90);
    expect(filled[0].takeProfit).toBe(130);
    expect(filled[0].state).toBe('open');
    expect(engine.pendingOrders).toHaveLength(0);
    expect(engine.openPositions).toHaveLength(1);
  });

  it('fills a short limit order when price reaches it', () => {
    const engine = new TradingEngine();
    unwrap(
      engine.placeLimitOrder({
        side: 'short',
        limitPrice: 105,
        size: 1,
      })
    );

    const untouched = engine.checkEntries(104);
    expect(untouched).toHaveLength(0);
    expect(engine.pendingOrders).toHaveLength(1);

    const filled = engine.checkEntries(106);

    expect(filled).toHaveLength(1);
    expect(filled[0].side).toBe('short');
    expect(filled[0].entryPrice).toBe(105);
    expect(engine.pendingOrders).toHaveLength(0);
  });
});
