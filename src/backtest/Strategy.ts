import { IndicatorId, PriceData } from '../types/asset';
import {
  PriceSeriesName,
  ResolvedStrategy,
  StrategyContext,
  StrategyDefinition,
  TradeRule,
  TradeSpec,
  TradeView,
} from '../types/backtest';
import { computeSeries } from '../services/IndicatorService';

const registry = new Map<string, StrategyDefinition>();

export function registerStrategy(definition: StrategyDefinition): void {
  registry.set(definition.id, definition);
}

export function getStrategy(id: string): StrategyDefinition | undefined {
  return registry.get(id);
}

export function listStrategies(): StrategyDefinition[] {
  return [...registry.values()];
}

export function clearStrategies(): void {
  registry.clear();
}

export function normalizeStrategyParams(
  definition: StrategyDefinition,
  params: Record<string, number>
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const spec of definition.params) {
    const value = params?.[spec.key];
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : spec.default;
    normalized[spec.key] = spec.min !== undefined ? Math.max(spec.min, numeric) : numeric;
  }
  return normalized;
}

export function resolveStrategy(
  id: string,
  params: Record<string, number> = {}
): ResolvedStrategy {
  const definition = registry.get(id);
  if (!definition) throw new Error(`Unknown strategy: ${id}`);
  return { definition, params: normalizeStrategyParams(definition, params) };
}

export function createContext(
  candles: PriceData[],
  index: number,
  trades: readonly TradeView[] = []
): StrategyContext {
  const upTo = candles.slice(0, index + 1);
  return {
    index,
    time: new Date(candles[index].date).getTime(),
    candle: () => candles[index],
    series: (name: PriceSeriesName) => upTo.map(candle => candle[name]),
    indicator: (indicatorId: IndicatorId, params: Record<string, number> = {}) =>
      computeSeries({ key: 'ctx', indicatorId, params }, upTo),
    trades: () => trades,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidRule(rule: TradeRule): boolean {
  if (!rule || typeof rule !== 'object') return false;

  switch (rule.kind) {
    case 'trailingStop':
      return isFiniteNumber(rule.distance) && rule.distance > 0;
    case 'breakEvenAtR':
      return isFiniteNumber(rule.rMultiple) && rule.rMultiple > 0;
    case 'partialTakeProfit':
      return (
        isFiniteNumber(rule.portion) &&
        rule.portion > 0 &&
        rule.portion <= 1 &&
        isFiniteNumber(rule.rMultiple) &&
        rule.rMultiple > 0
      );
    case 'closeWhen':
      return typeof rule.predicate === 'function';
    default:
      return false;
  }
}

export function isValidTradeSpec(spec: TradeSpec): boolean {
  if (!spec || typeof spec !== 'object') return false;
  if (spec.side !== 'long' && spec.side !== 'short') return false;
  if (
    !spec.order ||
    (spec.order.type !== 'market' &&
      spec.order.type !== 'limit' &&
      spec.order.type !== 'stop')
  ) {
    return false;
  }
  if (spec.order.type !== 'market' && !isFiniteNumber(spec.order.price)) return false;
  if (!spec.risk || !isFiniteNumber(spec.risk.fraction) || spec.risk.fraction <= 0) return false;
  if (spec.stopLoss !== undefined && !isFiniteNumber(spec.stopLoss)) return false;
  if (spec.takeProfit !== undefined && !isFiniteNumber(spec.takeProfit)) return false;
  if (!Array.isArray(spec.rules) || !spec.rules.every(isValidRule)) return false;
  return true;
}

export function validTradeSpecs(specs: TradeSpec[]): TradeSpec[] {
  return specs.filter(isValidTradeSpec);
}
