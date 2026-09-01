import { PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../timeframe/Timeframe';

export interface ValidationError {
  type: 'DUPLICATE_TIMESTAMP' | 'INVALID_VALUES' | 'UNORDERED';
  message: string;
  details: {
    rows?: number[];
    values?: Record<string, unknown>[];
  };
}

export interface ParseResult {
  success: boolean;
  data?: PriceData[];
  error?: ValidationError;
  warnings?: string[];
  detectedTimeframe?: TimeframeType;
}

function checkDuplicates(data: PriceData[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const candle of data) {
    if (seen.has(candle.date)) {
      duplicates.push(candle.date);
    }
    seen.add(candle.date);
  }

  return duplicates;
}

function validateCandle(candle: PriceData): { valid: boolean; error?: string } {
  if (
    candle.open < 0 ||
    candle.high < 0 ||
    candle.low < 0 ||
    candle.close < 0
  ) {
    return { valid: false, error: 'Negative price value' };
  }

  if (
    isNaN(candle.open) ||
    isNaN(candle.high) ||
    isNaN(candle.low) ||
    isNaN(candle.close) ||
    !isFinite(candle.open) ||
    !isFinite(candle.high) ||
    !isFinite(candle.low) ||
    !isFinite(candle.close)
  ) {
    return { valid: false, error: 'Invalid number (NaN or Infinity)' };
  }

  if (isNaN(candle.volume) || !isFinite(candle.volume)) {
    return { valid: false, error: 'Invalid volume' };
  }

  if (candle.high < candle.low) {
    return { valid: false, error: 'High is less than Low' };
  }

  return { valid: true };
}

export function validateAndParse(
  content: string,
  filename: string
): ParseResult {
  let data: PriceData[];

  if (filename.endsWith('.csv')) {
    const result = parseCSV(content);
    if (result.error) {
      return { success: false, error: result.error };
    }
    data = result.data!;
  } else if (filename.endsWith('.json')) {
    const result = parseJSON(content);
    if (result.error) {
      return { success: false, error: result.error };
    }
    data = result.data!;
  } else {
    return {
      success: false,
      error: {
        type: 'INVALID_VALUES',
        message: 'Unsupported file format. Use CSV or JSON.',
        details: {},
      },
    };
  }

  const duplicates = checkDuplicates(data);
  if (duplicates.length > 0) {
    return {
      success: false,
      error: {
        type: 'DUPLICATE_TIMESTAMP',
        message: `Duplicate timestamps found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}`,
        details: { values: duplicates.map(d => ({ date: d })) },
      },
    };
  }

  const invalidRows: { row: number; error: string }[] = [];
  for (let i = 0; i < data.length; i++) {
    const validation = validateCandle(data[i]);
    if (!validation.valid) {
      invalidRows.push({ row: i + 1, error: validation.error! });
    }
  }

  if (invalidRows.length > 0) {
    const firstFew = invalidRows.slice(0, 3);
    return {
      success: false,
      error: {
        type: 'INVALID_VALUES',
        message: `Invalid data at row ${firstFew[0].row}: ${firstFew[0].error}${invalidRows.length > 1 ? ` (+${invalidRows.length - 1} more)` : ''}`,
        details: {
          rows: invalidRows.map(r => r.row),
          values: firstFew.map(r => ({ row: r.row, error: r.error })),
        },
      },
    };
  }

  for (let i = 1; i < data.length; i++) {
    const prevTime = new Date(data[i - 1].date).getTime();
    const currTime = new Date(data[i].date).getTime();
    if (currTime < prevTime) {
      return {
        success: false,
        error: {
          type: 'UNORDERED',
          message: `Data is not ordered by date. Found row ${i + 1} with timestamp before row ${i}.`,
          details: { rows: [i, i + 1] },
        },
      };
    }
  }

  const gaps = Timeframe.detectGaps(data);
  const warnings: string[] = [];
  if (gaps.length > 0) {
    warnings.push(
      `Data contains gaps at approximately ${gaps.length} location(s). Some candles may be incomplete.`
    );
  }

  const { tf, confidence } = Timeframe.detect(data);
  if (confidence < 0.7) {
    warnings.push(
      `Could not detect timeframe with high confidence. Assuming 1D.`
    );
  }

  return {
    success: true,
    data,
    warnings,
    detectedTimeframe: tf,
  };
}

function parseCSV(content: string): { data?: PriceData[]; error?: ValidationError } {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    return {
      error: {
        type: 'INVALID_VALUES',
        message: 'CSV must have header and at least one data row',
        details: {},
      },
    };
  }

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const requiredFields = ['date', 'open', 'high', 'low', 'close', 'volume'];
  const headerIndices: Record<string, number> = {};

  for (const field of requiredFields) {
    const index = header.findIndex(h => h.includes(field));
    if (index === -1) {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: `Missing required field: ${field}`,
          details: {},
        },
      };
    }
    headerIndices[field] = index;
  }

  const data: PriceData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length !== header.length) continue;

    data.push({
      date: values[headerIndices['date']],
      open: parseFloat(values[headerIndices['open']]),
      high: parseFloat(values[headerIndices['high']]),
      low: parseFloat(values[headerIndices['low']]),
      close: parseFloat(values[headerIndices['close']]),
      volume: parseFloat(values[headerIndices['volume']]),
    });
  }

  if (data.length === 0) {
    return {
      error: {
        type: 'INVALID_VALUES',
        message: 'No valid data rows found',
        details: {},
      },
    };
  }

  return { data };
}

function parseJSON(content: string): { data?: PriceData[]; error?: ValidationError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      error: {
        type: 'INVALID_VALUES',
        message: 'Invalid JSON format',
        details: {},
      },
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      error: {
        type: 'INVALID_VALUES',
        message: 'JSON must be an array of price data',
        details: {},
      },
    };
  }

  for (const item of parsed) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('date' in item) ||
      !('open' in item) ||
      !('high' in item) ||
      !('low' in item) ||
      !('close' in item) ||
      !('volume' in item)
    ) {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'Each item must have date, open, high, low, close, volume',
          details: {},
        },
      };
    }
  }

  return { data: parsed as PriceData[] };
}
