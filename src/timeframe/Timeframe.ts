import { PriceData } from '../types/asset';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W';

interface TimeframeConfig {
  value: Timeframe;
  label: string;
  minutes: number;
  maxGapMultiplier: number;
}

const CONFIGS: TimeframeConfig[] = [
  { value: '1m', label: '1m', minutes: 1, maxGapMultiplier: 2 },
  { value: '5m', label: '5m', minutes: 5, maxGapMultiplier: 1.4 },
  { value: '15m', label: '15m', minutes: 15, maxGapMultiplier: 1.33 },
  { value: '1h', label: '1h', minutes: 60, maxGapMultiplier: 1.25 },
  { value: '4h', label: '4h', minutes: 240, maxGapMultiplier: 1.25 },
  { value: '1D', label: '1D', minutes: 1440, maxGapMultiplier: 1.04 },
  { value: '1W', label: '1W', minutes: 10080, maxGapMultiplier: 1.09 },
];

const VALUES = CONFIGS.map(c => c.value);
const MINUTES: Record<Timeframe, number> = {} as Record<Timeframe, number>;
const LABELS: Record<Timeframe, string> = {} as Record<Timeframe, string>;
const MAX_GAP_MULTIPLIER: Record<Timeframe, number> = {} as Record<Timeframe, number>;

for (const config of CONFIGS) {
  MINUTES[config.value] = config.minutes;
  LABELS[config.value] = config.label;
  MAX_GAP_MULTIPLIER[config.value] = config.maxGapMultiplier;
}

class TimeframeManager {
  private static instance: TimeframeManager;

  private constructor() {}

  static getInstance(): TimeframeManager {
    if (!TimeframeManager.instance) {
      TimeframeManager.instance = new TimeframeManager();
    }
    return TimeframeManager.instance;
  }

  getValues(): Timeframe[] {
    return VALUES;
  }

  getMinutes(tf: Timeframe): number {
    return MINUTES[tf];
  }

  getLabel(tf: Timeframe): string {
    return LABELS[tf];
  }

  getMaxGapMultiplier(tf: Timeframe): number {
    return MAX_GAP_MULTIPLIER[tf];
  }

  isValid(value: string): value is Timeframe {
    return VALUES.includes(value as Timeframe);
  }

  detect(data: PriceData[]): { tf: Timeframe; confidence: number } {
    if (data.length < 2) {
      return { tf: '1D', confidence: 0 };
    }

    const gaps: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const prev = new Date(data[i - 1].date).getTime();
      const curr = new Date(data[i].date).getTime();
      gaps.push((curr - prev) / 60000);
    }

    const histogram: Record<number, number> = {};
    for (const gap of gaps) {
      const rounded = Math.round(gap);
      histogram[rounded] = (histogram[rounded] || 0) + 1;
    }

    let mostCommonGap = 1;
    let maxCount = 0;
    for (const [gap, count] of Object.entries(histogram)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonGap = parseInt(gap, 10);
      }
    }

    let tf: Timeframe;
    if (mostCommonGap <= 2) tf = '1m';
    else if (mostCommonGap <= 7) tf = '5m';
    else if (mostCommonGap <= 20) tf = '15m';
    else if (mostCommonGap <= 75) tf = '1h';
    else if (mostCommonGap <= 300) tf = '4h';
    else if (mostCommonGap <= 1500) tf = '1D';
    else tf = '1W';

    const confidence = maxCount / gaps.length;

    return { tf, confidence };
  }

  detectGaps(data: PriceData[]): { startRow: number; endRow: number }[] {
    if (data.length < 2) return [];

    const gaps: { startRow: number; endRow: number }[] = [];
    const { tf } = this.detect(data);
    const expectedGap = MINUTES[tf];
    const maxGap = expectedGap * MAX_GAP_MULTIPLIER[tf];

    for (let i = 1; i < data.length; i++) {
      const prev = new Date(data[i - 1].date).getTime();
      const curr = new Date(data[i].date).getTime();
      const actualGap = (curr - prev) / 60000;

      if (actualGap > maxGap) {
        gaps.push({ startRow: i - 1, endRow: i });
      }
    }

    return gaps;
  }
}

export const Timeframe = TimeframeManager.getInstance();
