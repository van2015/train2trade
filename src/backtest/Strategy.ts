import { IndicatorId, PriceData } from '../types/asset';
import {
  CloseSignal,
  MoveStopSignal,
  MoveTargetSignal,
  OpenSignal,
  PriceSeriesName,
  PositionView,
  ResolvedStrategy,
  Signal,
  StrategyContext,
  StrategyDefinition,
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
  positions: readonly PositionView[] = []
): StrategyContext {
  const upTo = candles.slice(0, index + 1);
  return {
    index,
    time: new Date(candles[index].date).getTime(),
    candle: () => candles[index],
    series: (name: PriceSeriesName) => upTo.map(candle => candle[name]),
    indicator: (indicatorId: IndicatorId, params: Record<string, number> = {}) =>
      computeSeries({ key: 'ctx', indicatorId, params }, upTo),
    positions: () => positions,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidSignal(signal: Signal): boolean {
  if (!signal || typeof signal !== 'object') return false;

  switch (signal.kind) {
    case 'open': {
      const candidate = signal as OpenSignal;
      if (candidate.side !== 'long' && candidate.side !== 'short') return false;
      if (
        !candidate.order ||
        (candidate.order.type !== 'market' &&
          candidate.order.type !== 'limit' &&
          candidate.order.type !== 'stop')
      ) {
        return false;
      }
      if (candidate.order.type !== 'market' && !isFiniteNumber(candidate.order.price)) {
        return false;
      }
      if (!candidate.risk || !isFiniteNumber(candidate.risk.fraction) || candidate.risk.fraction <= 0) {
        return false;
      }
      if (candidate.stopLoss !== undefined && !isFiniteNumber(candidate.stopLoss)) return false;
      if (candidate.takeProfit !== undefined && !isFiniteNumber(candidate.takeProfit)) return false;
      return true;
    }
    case 'close': {
      const candidate = signal as CloseSignal;
      if (typeof candidate.positionId !== 'string' || candidate.positionId.length === 0) {
        return false;
      }
      if (
        candidate.portion !== undefined &&
        (!isFiniteNumber(candidate.portion) || candidate.portion <= 0 || candidate.portion > 1)
      ) {
        return false;
      }
      return true;
    }
    case 'moveStop':
    case 'moveTarget': {
      const candidate = signal as MoveStopSignal | MoveTargetSignal;
      if (typeof candidate.positionId !== 'string' || candidate.positionId.length === 0) {
        return false;
      }
      if (!isFiniteNumber(candidate.price)) return false;
      return true;
    }
    default:
      return false;
  }
}

export function validSignals(signals: Signal[]): Signal[] {
  return signals.filter(isValidSignal);
}
