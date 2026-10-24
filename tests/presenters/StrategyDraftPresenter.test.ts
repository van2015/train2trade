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
  });
});
