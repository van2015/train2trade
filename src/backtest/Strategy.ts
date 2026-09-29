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

export class StrategyManager {
  private static instance: StrategyManager;
  private registry = new Map<string, StrategyDefinition>();

  static getInstance(): StrategyManager {
    if (!StrategyManager.instance) {
      StrategyManager.instance = new StrategyManager();
    }
    return StrategyManager.instance;
  }

  registerStrategy(definition: StrategyDefinition): void {
    this.registry.set(definition.id, definition);
  }

  getStrategy(id: string): StrategyDefinition | undefined {
    return this.registry.get(id);
  }

  listStrategies(): StrategyDefinition[] {
    return [...this.registry.values()];
  }

  clearStrategies(): void {
    this.registry.clear();
  }

  normalizeStrategyParams(
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

  resolveStrategy(
    id: string,
    params: Record<string, number> = {}
  ): ResolvedStrategy {
    const definition = this.registry.get(id);
    if (!definition) throw new Error(`Unknown strategy: ${id}`);
    return { definition, params: this.normalizeStrategyParams(definition, params) };
  }

  createContext(
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

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private isValidRule(rule: TradeRule): boolean {
    if (!rule || typeof rule !== 'object') return false;

    switch (rule.kind) {
      case 'trailingStop':
        return this.isFiniteNumber(rule.distance) && rule.distance > 0;
      case 'breakEvenAtR':
        return this.isFiniteNumber(rule.rMultiple) && rule.rMultiple > 0;
      case 'partialTakeProfit':
        return (
          this.isFiniteNumber(rule.portion) &&
          rule.portion > 0 &&
          rule.portion <= 1 &&
          this.isFiniteNumber(rule.rMultiple) &&
          rule.rMultiple > 0
        );
      case 'closeWhen':
        return typeof rule.predicate === 'function';
      default:
        return false;
    }
  }

  isValidTradeSpec(spec: TradeSpec): boolean {
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
    if (spec.order.type !== 'market' && !this.isFiniteNumber(spec.order.price)) return false;
    if (!spec.risk || !this.isFiniteNumber(spec.risk.fraction) || spec.risk.fraction <= 0) return false;
    if (spec.stopLoss !== undefined && !this.isFiniteNumber(spec.stopLoss)) return false;
    if (spec.takeProfit !== undefined && !this.isFiniteNumber(spec.takeProfit)) return false;
    if (!Array.isArray(spec.rules) || !spec.rules.every(r => this.isValidRule(r))) return false;
    return true;
  }

  validTradeSpecs(specs: TradeSpec[]): TradeSpec[] {
    return specs.filter(spec => this.isValidTradeSpec(spec));
  }
}

const globalManager = StrategyManager.getInstance();

export function registerStrategy(definition: StrategyDefinition): void {
  globalManager.registerStrategy(definition);
}

export function getStrategy(id: string): StrategyDefinition | undefined {
  return globalManager.getStrategy(id);
}

export function listStrategies(): StrategyDefinition[] {
  return globalManager.listStrategies();
}

export function clearStrategies(): void {
  globalManager.clearStrategies();
}

export function normalizeStrategyParams(
  definition: StrategyDefinition,
  params: Record<string, number>
): Record<string, number> {
  return globalManager.normalizeStrategyParams(definition, params);
}

export function resolveStrategy(
  id: string,
  params: Record<string, number> = {}
): ResolvedStrategy {
  return globalManager.resolveStrategy(id, params);
}

export function createContext(
  candles: PriceData[],
  index: number,
  trades: readonly TradeView[] = []
): StrategyContext {
  return globalManager.createContext(candles, index, trades);
}

export function isValidTradeSpec(spec: TradeSpec): boolean {
  return globalManager.isValidTradeSpec(spec);
}

export function validTradeSpecs(specs: TradeSpec[]): TradeSpec[] {
  return globalManager.validTradeSpecs(specs);
}
