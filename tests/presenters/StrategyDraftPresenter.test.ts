import { describe, expect, it } from 'vitest';
import {
  type ConditionField,
  StrategyDraftPresenter,
} from '../../src/strategy/StrategyDraftPresenter';

function fillCondition(
  presenter: StrategyDraftPresenter,
  field: ConditionField,
  indicatorId: 'close' | 'open' | 'high' | 'low',
  operator: 'gt' | 'lt',
  value: number
) {
  presenter.setConditionIndicator(field, indicatorId);
  presenter.setConditionOperator(field, operator);
  presenter.setConditionValue(field, value);
}

function fillIndicatorCondition(
  presenter: StrategyDraftPresenter,
  field: ConditionField,
  left: 'close' | 'open' | 'high' | 'low',
  operator: 'gt' | 'lt',
  right: 'close' | 'open' | 'high' | 'low'
) {
  presenter.setConditionIndicator(field, left);
  presenter.setConditionOperator(field, operator);
  presenter.setConditionRightSide(field, 'indicator');
  presenter.setConditionRightIndicator(field, right);
}

describe('StrategyDraftPresenter', () => {
  describe('a new strategy', () => {
    it('starts as not ready, reporting the name and all three conditions as missing', () => {
      const presenter = new StrategyDraftPresenter();

      const state = presenter.getState();

      expect(state.isReady).toBe(false);
      expect(state.missing).toEqual([
        'name',
        'entry.indicator',
        'entry.operator',
        'entry.value',
        'stopLoss.indicator',
        'stopLoss.operator',
        'stopLoss.value',
        'takeProfit.indicator',
        'takeProfit.operator',
        'takeProfit.value',
      ]);
    });

    it('stays not ready and reports only the name when the three conditions are complete', () => {
      const presenter = new StrategyDraftPresenter();
      fillCondition(presenter, 'entry', 'close', 'gt', 100);
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      fillCondition(presenter, 'takeProfit', 'high', 'gt', 120);

      const state = presenter.getState();

      expect(state.isReady).toBe(false);
      expect(state.missing).toEqual(['name']);
    });

    it('reports each missing condition field (indicator, operator or value)', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('Breakout');
      presenter.setConditionIndicator('entry', 'close');
      presenter.setConditionOperator('entry', 'gt');
      presenter.setConditionOperator('stopLoss', 'lt');
      presenter.setConditionValue('stopLoss', 90);
      presenter.setConditionIndicator('takeProfit', 'high');
      presenter.setConditionValue('takeProfit', 120);

      const state = presenter.getState();

      expect(state.isReady).toBe(false);
      expect(state.missing).toEqual([
        'entry.value',
        'stopLoss.indicator',
        'takeProfit.operator',
      ]);
    });

    it('becomes ready and exposes a summary of the name and the three conditions once complete', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('Breakout');
      fillCondition(presenter, 'entry', 'close', 'gt', 100);
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      fillCondition(presenter, 'takeProfit', 'high', 'gt', 120);

      const state = presenter.getState();

      expect(state.isReady).toBe(true);
      expect(state.missing).toEqual([]);
      expect(state.name).toBe('Breakout');
      expect(state.summary).toEqual({
        entry: 'Close > 100',
        stopLoss: 'Low < 90',
        takeProfit: 'High > 120',
      });
    });

    it('keeps a condition incomplete when indicator mode is selected without a right indicator', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('Cross');
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      fillCondition(presenter, 'takeProfit', 'high', 'gt', 120);
      presenter.setConditionIndicator('entry', 'close');
      presenter.setConditionOperator('entry', 'gt');
      presenter.setConditionRightSide('entry', 'indicator');

      const state = presenter.getState();

      expect(state.isReady).toBe(false);
      expect(state.missing).toEqual(['entry.rightIndicator']);
    });

    it('becomes ready when the three conditions compare indicators', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('Indicator cross');
      fillIndicatorCondition(presenter, 'entry', 'close', 'gt', 'open');
      fillIndicatorCondition(presenter, 'stopLoss', 'low', 'lt', 'close');
      fillIndicatorCondition(presenter, 'takeProfit', 'high', 'gt', 'close');

      const state = presenter.getState();

      expect(state.isReady).toBe(true);
      expect(state.missing).toEqual([]);
      expect(state.summary).toEqual({
        entry: 'Close > Open',
        stopLoss: 'Low < Close',
        takeProfit: 'High > Close',
      });
    });

    it('applies default params to the right indicator and updates them in the summary', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('RSI cross');
      fillCondition(presenter, 'entry', 'close', 'gt', 100);
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      presenter.setConditionIndicator('takeProfit', 'close');
      presenter.setConditionOperator('takeProfit', 'gt');
      presenter.setConditionRightSide('takeProfit', 'indicator');
      presenter.setConditionRightIndicator('takeProfit', 'rsi');

      const initial = presenter.getState();
      expect(initial.conditions.takeProfit.rightParams).toEqual({ period: 14 });
      expect(initial.summary?.takeProfit).toBe('Close > RSI(14)');

      presenter.updateConditionRightParams('takeProfit', { period: 21 });

      const updated = presenter.getState();
      expect(updated.conditions.takeProfit.rightParams).toEqual({ period: 21 });
      expect(updated.summary?.takeProfit).toBe('Close > RSI(21)');
    });

    it('summarises cross above and cross below between two indicators', () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('EMA cross');
      presenter.setConditionIndicator('entry', 'ema');
      presenter.setConditionOperator('entry', 'crossAbove');
      presenter.setConditionRightSide('entry', 'indicator');
      presenter.setConditionRightIndicator('entry', 'ema');
      presenter.updateConditionRightParams('entry', { period: 50 });
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      presenter.setConditionIndicator('takeProfit', 'close');
      presenter.setConditionOperator('takeProfit', 'crossBelow');
      presenter.setConditionRightSide('takeProfit', 'indicator');
      presenter.setConditionRightIndicator('takeProfit', 'ema');

      const state = presenter.getState();

      expect(state.isReady).toBe(true);
      expect(state.missing).toEqual([]);
      expect(state.summary).toEqual({
        entry: 'EMA(20) crosses above EMA(50)',
        stopLoss: 'Low < 90',
        takeProfit: 'Close crosses below EMA(20)',
      });
    });

    it("applies a technical indicator's default params and updates the summary after editing them", () => {
      const presenter = new StrategyDraftPresenter();
      presenter.setName('Oversold');
      fillCondition(presenter, 'entry', 'close', 'gt', 100);
      fillCondition(presenter, 'stopLoss', 'low', 'lt', 90);
      presenter.setConditionIndicator('takeProfit', 'rsi');
      presenter.setConditionOperator('takeProfit', 'gt');
      presenter.setConditionValue('takeProfit', 70);

      const initial = presenter.getState();
      expect(initial.conditions.takeProfit.params).toEqual({ period: 14 });
      expect(initial.summary?.takeProfit).toBe('RSI(14) > 70');

      presenter.updateConditionParams('takeProfit', { period: 21 });

      const updated = presenter.getState();
      expect(updated.conditions.takeProfit.params).toEqual({ period: 21 });
      expect(updated.summary?.takeProfit).toBe('RSI(21) > 70');
    });
  });
});
