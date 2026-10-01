import {
  ChartType,
  IndicatorId,
  IndicatorInstance,
} from '../../shared/types/asset';
import { Timeframe } from '../../backtest/timeframe/Timeframe';
import { Interval } from '../../shared/utils/Interval';
import {
  createIndicatorInstance,
  getDefinition,
  maxLookback,
  normalizeParams,
} from '../../backtest/indicators/IndicatorService';

const TIMEFRAME_STORAGE_KEY = 'selectedTimeframe';
const INDICATORS_STORAGE_KEY = 'activeIndicators';

export interface ChartState {
  chartType: ChartType;
  selectedTimeframe: Timeframe;
  activeIndicators: IndicatorInstance[];
}

export interface ChartPresenterOptions {
  onStateChange?: (state: ChartState) => void;
}

export class ChartPresenter {
  private chartType: ChartType = 'line';
  private selectedTimeframe: Timeframe = '1D';
  private activeIndicators: IndicatorInstance[] = [];
  private listeners: Set<(state: ChartState) => void> = new Set();
  private options: ChartPresenterOptions;

  constructor(options: ChartPresenterOptions = {}) {
    this.options = options;
    this.loadTimeframeFromStorage();
    this.loadIndicatorsFromStorage();
  }

  subscribe(fn: (state: ChartState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach(fn => fn(state));
    this.options.onStateChange?.(state);
  }

  getState(): ChartState {
    return {
      chartType: this.chartType,
      selectedTimeframe: this.selectedTimeframe,
      activeIndicators: this.activeIndicators,
    };
  }

  private loadTimeframeFromStorage(): void {
    try {
      const stored = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
      if (stored && Timeframe.isValid(stored)) {
        this.selectedTimeframe = stored as Timeframe;
      }
    } catch {
      this.selectedTimeframe = '1D';
    }
  }

  private saveTimeframeToStorage(): void {
    try {
      localStorage.setItem(TIMEFRAME_STORAGE_KEY, this.selectedTimeframe);
    } catch {}
  }

  private loadIndicatorsFromStorage(): void {
    try {
      const stored = localStorage.getItem(INDICATORS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      this.activeIndicators = parsed
        .map(raw => this.sanitizeIndicator(raw))
        .filter((indicator): indicator is IndicatorInstance => indicator !== null);
    } catch {
      this.activeIndicators = [];
    }
  }

  private sanitizeIndicator(raw: unknown): IndicatorInstance | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<IndicatorInstance>;
    if (typeof candidate.key !== 'string' || candidate.key.length === 0) return null;
    if (typeof candidate.indicatorId !== 'string') return null;
    const definition = getDefinition(candidate.indicatorId as IndicatorId);
    if (!definition) return null;
    const params = normalizeParams(
      definition,
      (candidate.params ?? {}) as Record<string, number>
    );
    return {
      key: candidate.key,
      indicatorId: definition.id,
      params,
      color: typeof candidate.color === 'string' ? candidate.color : undefined,
    };
  }

  private saveIndicatorsToStorage(): void {
    try {
      localStorage.setItem(INDICATORS_STORAGE_KEY, JSON.stringify(this.activeIndicators));
    } catch {}
  }

  changeChartType(type: ChartType): void {
    this.chartType = type;
    this.notify();
  }

  changeTimeframe(tf: Timeframe): void {
    this.selectedTimeframe = tf;
    this.saveTimeframeToStorage();
    this.notify();
  }

  getActiveIndicators(): IndicatorInstance[] {
    return this.activeIndicators;
  }

  setActiveIndicators(indicators: IndicatorInstance[]): void {
    this.activeIndicators = indicators;
  }

  addIndicator(id: IndicatorId): void {
    const instance = createIndicatorInstance(id);
    if (!instance) return;
    this.activeIndicators = [...this.activeIndicators, instance];
    this.saveIndicatorsToStorage();
    this.notify();
  }

  removeIndicator(key: string): void {
    const next = this.activeIndicators.filter(indicator => indicator.key !== key);
    if (next.length === this.activeIndicators.length) return;
    this.activeIndicators = next;
    this.saveIndicatorsToStorage();
    this.notify();
  }

  updateIndicator(key: string, params: Record<string, number>): void {
    let changed = false;
    this.activeIndicators = this.activeIndicators.map(indicator => {
      if (indicator.key !== key) return indicator;
      const definition = getDefinition(indicator.indicatorId);
      if (!definition) return indicator;
      changed = true;
      return {
        ...indicator,
        params: normalizeParams(definition, { ...indicator.params, ...params }),
      };
    });
    if (!changed) return;
    this.saveIndicatorsToStorage();
    this.notify();
  }

  hasCompleteData(
    loadedRange: { contains: (range: Interval) => boolean } | null,
    currentRange: Interval | null,
    lastSampleTime: number | null
  ): boolean {
    if (!loadedRange || !currentRange) return false;
    const warmupMs = maxLookback(this.activeIndicators, this.selectedTimeframe);
    const requiredTo =
      lastSampleTime !== null
        ? Math.min(currentRange.to, lastSampleTime)
        : currentRange.to;
    const required = new Interval(currentRange.from - warmupMs, requiredTo);
    return loadedRange.contains(required);
  }

  getMaxLookback(): number {
    return maxLookback(this.activeIndicators, this.selectedTimeframe);
  }
}
