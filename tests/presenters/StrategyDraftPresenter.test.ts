import { describe, expect, it } from 'vitest';
import type { ConditionField } from '../../src/strategy/StrategyDraftPresenter';
import { aStrategyDraft } from '../test-helpers/strategyDraftBuilder';

describe('StrategyDraftPresenter', () => {
  describe('a new strategy', () => {
    it('a new strategy reports direction, risk and trigger as missing alongside name and conditions', () => {
      const presenter = aStrategyDraft().build();

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual([
        'name',
        'direction',
        'risk',
        'trigger',
        'entry.1.indicator',
        'entry.1.operator',
        'entry.1.value',
        'stopLoss.1.indicator',
        'stopLoss.1.operator',
        'stopLoss.1.value',
        'takeProfit.1.indicator',
        'takeProfit.1.operator',
        'takeProfit.1.value',
      ]);
    });

    it('stays not ready and reports direction, risk or trigger while any of them is unset', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withDefaultConditions()
        .build();

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual(['direction', 'risk', 'trigger']);

      presenter.setDirection('long');
      presenter.setRisk(1);
      expect(presenter.getMissing()).toEqual(['trigger']);

      presenter.setTrigger('entry');
      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
    });

    it('stays not ready and reports the risk when it is not a number greater than zero', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withDefaultConditions()
        .withOpening()
        .build();

      for (const risk of [0, -1, NaN]) {
        presenter.setRisk(risk);

        expect(presenter.isReady()).toBe(false);
        expect(presenter.getMissing()).toEqual(['risk']);
      }
    });

    it('stays not ready and reports only the name when the conditions and the opening are complete', () => {
      const presenter = aStrategyDraft()
        .withDefaultConditions()
        .withOpening()
        .build();

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual(['name']);
    });

    it('reports each missing condition field (indicator, operator or value)', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withOpening()
        .build();
      presenter.setConditionIndicator('entry', 'close');
      presenter.setConditionOperator('entry', 'gt');
      presenter.setConditionOperator('stopLoss', 'lt');
      presenter.setConditionValue('stopLoss', 90);
      presenter.setConditionIndicator('takeProfit', 'high');
      presenter.setConditionValue('takeProfit', 120);

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual([
        'entry.1.value',
        'stopLoss.1.indicator',
        'takeProfit.1.operator',
      ]);
    });

    it('becomes ready and exposes a summary of the name and the three conditions once complete', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withDefaultConditions()
        .withOpening()
        .build();

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getName()).toBe('Breakout');
      expect(presenter.getSummary()).toMatchObject({
        entry: 'Close > 100',
        stopLoss: 'Low < 90',
        takeProfit: 'High > 120',
      });
    });

    it('becomes ready and summarises direction, market opening, risk and trigger along with the conditions', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withDefaultConditions()
        .withOpening('short', 2.5, 'stopLoss')
        .build();

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()).toEqual({
        direction: 'Short',
        opening: 'Market',
        risk: '2.5%',
        trigger: 'Stop Loss',
        entry: 'Close > 100',
        stopLoss: 'Low < 90',
        takeProfit: 'High > 120',
      });
    });

    it('keeps the summary null until direction, risk and trigger are complete', () => {
      const presenter = aStrategyDraft()
        .named('Breakout')
        .withDefaultConditions()
        .build();

      expect(presenter.getSummary()).toBeNull();

      presenter.setDirection('long');
      expect(presenter.getSummary()).toBeNull();

      presenter.setRisk(1);
      expect(presenter.getSummary()).toBeNull();

      presenter.setTrigger('entry');
      expect(presenter.getSummary()).toMatchObject({
        direction: 'Long',
        opening: 'Market',
        risk: '1%',
        trigger: 'Entry',
      });
    });

    it('summarises a limit opening with the limit price indicator and its params', () => {
      const presenter = aStrategyDraft()
        .named('Limit entry')
        .withDefaultConditions()
        .withOpening()
        .build();
      presenter.setOrderType('limit');
      presenter.setLimitIndicator('rsi');

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()?.opening).toBe('Limit RSI(14)');
    });

    it('stays not ready and reports the limit price indicator when the opening is limit without one', () => {
      const presenter = aStrategyDraft()
        .named('Limit entry')
        .withDefaultConditions()
        .withOpening()
        .build();
      presenter.setOrderType('limit');

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual(['limitIndicator']);
      expect(presenter.getSummary()).toBeNull();

      presenter.setLimitIndicator('close');

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
    });

    it('keeps a market opening without asking for a limit price indicator, even after switching back from limit', () => {
      const presenter = aStrategyDraft()
        .named('Market entry')
        .withDefaultConditions()
        .withOpening()
        .build();

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()?.opening).toBe('Market');

      presenter.setOrderType('limit');
      expect(presenter.getMissing()).toEqual(['limitIndicator']);

      presenter.setOrderType('market');
      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()?.opening).toBe('Market');
    });

    it('updates the limit price indicator params in the summary', () => {
      const presenter = aStrategyDraft()
        .named('Limit entry')
        .withDefaultConditions()
        .withOpening()
        .build();
      presenter.setOrderType('limit');
      presenter.setLimitIndicator('rsi');

      expect(presenter.getSummary()?.opening).toBe('Limit RSI(14)');

      presenter.updateLimitParams({ period: 21 });

      expect(presenter.getSummary()?.opening).toBe('Limit RSI(21)');
    });

    it('keeps a condition incomplete when indicator mode is selected without a right indicator', () => {
      const presenter = aStrategyDraft()
        .named('Cross')
        .withOpening()
        .withCondition('stopLoss', 'low', 'lt', 90)
        .withCondition('takeProfit', 'high', 'gt', 120)
        .build();
      presenter.setConditionIndicator('entry', 'close');
      presenter.setConditionOperator('entry', 'gt');
      presenter.setConditionRightSide('entry', 'indicator');

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getMissing()).toEqual(['entry.1.rightIndicator']);
    });

    it('becomes ready when the three conditions compare indicators', () => {
      const presenter = aStrategyDraft()
        .named('Indicator cross')
        .withOpening()
        .withIndicatorCondition('entry', 'close', 'gt', 'open')
        .withIndicatorCondition('stopLoss', 'low', 'lt', 'close')
        .withIndicatorCondition('takeProfit', 'high', 'gt', 'close')
        .build();

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()).toMatchObject({
        entry: 'Close > Open',
        stopLoss: 'Low < Close',
        takeProfit: 'High > Close',
      });
    });

    it('applies default params to the right indicator and updates them in the summary', () => {
      const presenter = aStrategyDraft()
        .named('RSI cross')
        .withOpening()
        .withCondition('entry', 'close', 'gt', 100)
        .withCondition('stopLoss', 'low', 'lt', 90)
        .build();
      presenter.setConditionIndicator('takeProfit', 'close');
      presenter.setConditionOperator('takeProfit', 'gt');
      presenter.setConditionRightSide('takeProfit', 'indicator');
      presenter.setConditionRightIndicator('takeProfit', 'rsi');

      expect(
        presenter.getConditions().takeProfit.conditions[0].rightParams
      ).toEqual({ period: 14 });
      expect(presenter.getSummary()?.takeProfit).toBe('Close > RSI(14)');

      presenter.updateConditionRightParams('takeProfit', { period: 21 });

      expect(
        presenter.getConditions().takeProfit.conditions[0].rightParams
      ).toEqual({ period: 21 });
      expect(presenter.getSummary()?.takeProfit).toBe('Close > RSI(21)');
    });

    it('summarises cross above and cross below between two indicators', () => {
      const presenter = aStrategyDraft()
        .named('EMA cross')
        .withOpening()
        .withCondition('stopLoss', 'low', 'lt', 90)
        .build();
      presenter.setConditionIndicator('entry', 'ema');
      presenter.setConditionOperator('entry', 'crossAbove');
      presenter.setConditionRightSide('entry', 'indicator');
      presenter.setConditionRightIndicator('entry', 'ema');
      presenter.updateConditionRightParams('entry', { period: 50 });
      presenter.setConditionIndicator('takeProfit', 'close');
      presenter.setConditionOperator('takeProfit', 'crossBelow');
      presenter.setConditionRightSide('takeProfit', 'indicator');
      presenter.setConditionRightIndicator('takeProfit', 'ema');

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()).toMatchObject({
        entry: 'EMA(20) crosses above EMA(50)',
        stopLoss: 'Low < 90',
        takeProfit: 'Close crosses below EMA(20)',
      });
    });

    it("applies a technical indicator's default params and updates the summary after editing them", () => {
      const presenter = aStrategyDraft()
        .named('Oversold')
        .withOpening()
        .withCondition('entry', 'close', 'gt', 100)
        .withCondition('stopLoss', 'low', 'lt', 90)
        .build();
      presenter.setConditionIndicator('takeProfit', 'rsi');
      presenter.setConditionOperator('takeProfit', 'gt');
      presenter.setConditionValue('takeProfit', 70);

      expect(presenter.getConditions().takeProfit.conditions[0].params).toEqual(
        { period: 14 }
      );
      expect(presenter.getSummary()?.takeProfit).toBe('RSI(14) > 70');

      presenter.updateConditionParams('takeProfit', { period: 21 });

      expect(presenter.getConditions().takeProfit.conditions[0].params).toEqual(
        { period: 21 }
      );
      expect(presenter.getSummary()?.takeProfit).toBe('RSI(21) > 70');
    });
  });

  describe('composing conditions', () => {
    it('joins two complete simple conditions with the chosen connector in each field summary', () => {
      const compositions: {
        field: ConditionField;
        connector: 'and' | 'or';
        first: ['close' | 'open' | 'high' | 'low', 'gt' | 'lt', number];
        second: ['close' | 'open' | 'high' | 'low', 'gt' | 'lt', number];
      }[] = [
        {
          field: 'entry',
          connector: 'and',
          first: ['close', 'gt', 100],
          second: ['low', 'lt', 90],
        },
        {
          field: 'stopLoss',
          connector: 'or',
          first: ['low', 'lt', 90],
          second: ['high', 'gt', 120],
        },
        {
          field: 'takeProfit',
          connector: 'and',
          first: ['high', 'gt', 120],
          second: ['close', 'gt', 100],
        },
      ];

      const builder = aStrategyDraft().named('Composed').withOpening();
      for (const { field, first, second } of compositions) {
        builder
          .withCondition(field, first[0], first[1], first[2])
          .withCondition(field, second[0], second[1], second[2], 1);
      }
      const presenter = builder.build();
      for (const { field, connector } of compositions) {
        presenter.setConditionConnector(field, connector);
      }

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getMissing()).toEqual([]);
      expect(presenter.getSummary()).toMatchObject({
        entry: 'Close > 100 AND Low < 90',
        stopLoss: 'Low < 90 OR High > 120',
        takeProfit: 'High > 120 AND Close > 100',
      });
    });

    it('prefixes a negated simple condition with NOT in the summary', () => {
      const presenter = aStrategyDraft()
        .named('Negated')
        .withOpening()
        .withCondition('entry', 'close', 'gt', 100)
        .withCondition('entry', 'low', 'lt', 90, 1)
        .withCondition('stopLoss', 'low', 'lt', 90)
        .withCondition('takeProfit', 'high', 'gt', 120)
        .build();
      presenter.setConditionNegated('entry', true, 1);

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getSummary()?.entry).toBe(
        'Close > 100 AND NOT (Low < 90)'
      );

      presenter.setConditionNegated('entry', false, 1);

      expect(presenter.getSummary()?.entry).toBe('Close > 100 AND Low < 90');
    });

    it('reports each incomplete simple condition with its field and position in missing', () => {
      const presenter = aStrategyDraft()
        .named('Incomplete composition')
        .withOpening()
        .withCondition('entry', 'close', 'gt', 100)
        .withCondition('stopLoss', 'low', 'lt', 90)
        .withCondition('takeProfit', 'high', 'gt', 120)
        .build();
      presenter.addCondition('entry');
      presenter.setConditionIndicator('entry', 'low', 1);
      presenter.setConditionOperator('entry', 'lt', 1);
      presenter.addCondition('stopLoss');
      presenter.setConditionIndicator('stopLoss', 'high', 1);
      presenter.setConditionValue('stopLoss', 120, 1);

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getSummary()).toBeNull();
      expect(presenter.getMissing()).toEqual([
        'entry.2.value',
        'stopLoss.2.operator',
      ]);
    });

    it('reports a field with no simple conditions as missing', () => {
      const presenter = aStrategyDraft()
        .named('Empty entry')
        .withOpening()
        .withDefaultConditions()
        .build();

      presenter.removeCondition('entry', 0);

      expect(presenter.isReady()).toBe(false);
      expect(presenter.getSummary()).toBeNull();
      expect(presenter.getMissing()).toEqual(['entry.conditions']);
    });

    it('removes one of two simple conditions and updates the summary', () => {
      const presenter = aStrategyDraft()
        .named('Remove condition')
        .withOpening()
        .withCondition('entry', 'close', 'gt', 100)
        .withCondition('entry', 'low', 'lt', 90, 1)
        .withCondition('stopLoss', 'low', 'lt', 90)
        .withCondition('takeProfit', 'high', 'gt', 120)
        .build();
      presenter.setConditionConnector('entry', 'and');

      expect(presenter.getSummary()?.entry).toBe('Close > 100 AND Low < 90');

      presenter.removeCondition('entry', 0);

      expect(presenter.isReady()).toBe(true);
      expect(presenter.getSummary()?.entry).toBe('Low < 90');
    });
  });
});
