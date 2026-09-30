import { Timeframe, Timeframe as TimeframeType } from '../shared/timeframe/Timeframe';
import { PriceData } from '../shared/types/asset';

export interface TestDataParams {
  assetName: string;
  timeframe: TimeframeType;
  startingPrice: number;
  volatility: number;
  volumeMin: number;
  volumeMax: number;
  sampleCount: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateParams(params: TestDataParams): ValidationResult {
  const errors: string[] = [];

  if (!params.assetName || params.assetName.trim() === '') {
    errors.push('Asset name is required');
  }

  if (params.startingPrice <= 0) {
    errors.push('Starting price must be greater than 0');
  }

  if (params.volatility < 0.1 || params.volatility > 10) {
    errors.push('Volatility must be between 0.1% and 10%');
  }

  if (params.volumeMin >= params.volumeMax) {
    errors.push('Volume minimum must be less than maximum');
  }

  if (params.volumeMin <= 0 || params.volumeMax <= 0) {
    errors.push('Volume values must be greater than 0');
  }

  return { valid: errors.length === 0, errors };
}

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function formatDate(date: Date): string {
  return date.toISOString().replace('.000Z', 'Z');
}

export function generateTestData(params: TestDataParams): PriceData[] {
  const timeframeMinutes = Timeframe.getMinutes(params.timeframe);
  const totalDurationMs = params.sampleCount * timeframeMinutes * 60 * 1000;
  const now = Date.now();
  const startDate = new Date(now - totalDurationMs);

  const candles: PriceData[] = [];
  let currentPrice = params.startingPrice;

  for (let i = 0; i < params.sampleCount; i++) {
    const date = new Date(startDate.getTime() + i * timeframeMinutes * 60 * 1000);
    const open = currentPrice;

    const changePercent = randomInRange(-params.volatility, params.volatility) / 100;
    const close = open * (1 + changePercent);

    const maxOpenClose = Math.max(open, close);
    const minOpenClose = Math.min(open, close);

    const highExtra = randomInRange(0, 0.005) * maxOpenClose;
    const lowExtra = randomInRange(0, 0.005) * minOpenClose;

    const high = maxOpenClose + highExtra;
    const low = minOpenClose - lowExtra;

    const volume = Math.floor(randomInRange(params.volumeMin, params.volumeMax));

    candles.push({
      date: formatDate(date),
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

export function generateCSV(params: TestDataParams): string {
  const candles = generateTestData(params);
  const header = 'date,open,high,low,close,volume';
  const rows = candles.map(c => 
    `${c.date},${c.open.toFixed(2)},${c.high.toFixed(2)},${c.low.toFixed(2)},${c.close.toFixed(2)},${c.volume}`
  );
  return [header, ...rows].join('\n');
}
