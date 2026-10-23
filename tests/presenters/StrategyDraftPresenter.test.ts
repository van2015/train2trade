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
  });
});
