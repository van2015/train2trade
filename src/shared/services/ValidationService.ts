import {
  Timeframe,
  type Timeframe as TimeframeType,
} from '../../backtest/timeframe/Timeframe';
import type { PriceData } from '../types/asset';
import type { Result } from '../types/Result';

export interface ValidationError {
  type: 'DUPLICATE_TIMESTAMP' | 'INVALID_VALUES' | 'UNORDERED';
  message: string;
  details: {
    rows?: number[];
    values?: Record<string, unknown>[];
  };
}

export interface ParseSuccess {
  data: PriceData[];
  warnings: string[];
  detectedTimeframe: TimeframeType;
}

export type ParseResult = Result<ParseSuccess, ValidationError>;

export class DataValidator {
  private checkDuplicates(data: PriceData[]): string[] {
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

  private validateCandle(candle: PriceData): Result<void, string> {
    const negativeError = this.checkForNegativePrices(candle);
    if (!negativeError.success) return negativeError;

    const invalidNumberError = this.checkForInvalidNumbers(candle);
    if (!invalidNumberError.success) return invalidNumberError;

    const volumeError = this.checkForInvalidVolume(candle);
    if (!volumeError.success) return volumeError;

    const highLowError = this.checkHighLowConsistency(candle);
    if (!highLowError.success) return highLowError;

    return { success: true, value: undefined };
  }

  private checkForNegativePrices(candle: PriceData): Result<void, string> {
    if (
      candle.open < 0 ||
      candle.high < 0 ||
      candle.low < 0 ||
      candle.close < 0
    ) {
      return { success: false, error: 'Negative price value' };
    }
    return { success: true, value: undefined };
  }

  private checkForInvalidNumbers(candle: PriceData): Result<void, string> {
    if (
      Number.isNaN(candle.open) ||
      Number.isNaN(candle.high) ||
      Number.isNaN(candle.low) ||
      Number.isNaN(candle.close) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      return { success: false, error: 'Invalid number (NaN or Infinity)' };
    }
    return { success: true, value: undefined };
  }

  private checkForInvalidVolume(candle: PriceData): Result<void, string> {
    if (Number.isNaN(candle.volume) || !Number.isFinite(candle.volume)) {
      return { success: false, error: 'Invalid volume' };
    }
    return { success: true, value: undefined };
  }

  private checkHighLowConsistency(candle: PriceData): Result<void, string> {
    if (candle.high < candle.low) {
      return { success: false, error: 'High is less than Low' };
    }
    return { success: true, value: undefined };
  }

  private parseCSV(content: string): Result<PriceData[], ValidationError> {
    const lines = content.trim().split('\n');

    const headerResult = this.validateHeaderExists(lines);
    if (!headerResult.success) {
      return { success: false, error: headerResult.error };
    }

    const headerResult2 = this.parseHeaderIndices(lines[0]);
    if (!headerResult2.success) {
      return { success: false, error: headerResult2.error };
    }

    return this.parseDataRows(lines, headerResult2.value);
  }

  private validateHeaderExists(lines: string[]): Result<void, ValidationError> {
    if (lines.length < 2) {
      return {
        success: false,
        error: {
          type: 'INVALID_VALUES',
          message: 'CSV must have header and at least one data row',
          details: {},
        },
      };
    }
    return { success: true, value: undefined };
  }

  private parseHeaderIndices(
    headerLine: string
  ): Result<Record<string, number>, ValidationError> {
    const header = headerLine
      .toLowerCase()
      .split(',')
      .map((h) => h.trim());
    const requiredFields = ['date', 'open', 'high', 'low', 'close', 'volume'];
    const headerIndices: Record<string, number> = {};

    for (const field of requiredFields) {
      const index = header.findIndex((h) => h.includes(field));
      if (index === -1) {
        return {
          success: false,
          error: {
            type: 'INVALID_VALUES',
            message: `Missing required field: ${field}`,
            details: {},
          },
        };
      }
      headerIndices[field] = index;
    }

    return { success: true, value: headerIndices };
  }

  private parseDataRows(
    lines: string[],
    headerIndices: Record<string, number>
  ): Result<PriceData[], ValidationError> {
    const data: PriceData[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length !== lines[0].split(',').length) continue;

      data.push({
        date: values[headerIndices.date],
        open: parseFloat(values[headerIndices.open]),
        high: parseFloat(values[headerIndices.high]),
        low: parseFloat(values[headerIndices.low]),
        close: parseFloat(values[headerIndices.close]),
        volume: parseFloat(values[headerIndices.volume]),
      });
    }

    if (data.length === 0) {
      return {
        success: false,
        error: {
          type: 'INVALID_VALUES',
          message: 'No valid data rows found',
          details: {},
        },
      };
    }

    return { success: true, value: data };
  }

  private parseJSON(content: string): Result<PriceData[], ValidationError> {
    const parsedResult = this.parseJSONContent(content);
    if (parsedResult.error) {
      return { success: false, error: parsedResult.error };
    }

    const arrayResult = this.validateJSONStructure(parsedResult.parsed);
    if (!arrayResult.success) {
      return { success: false, error: arrayResult.error };
    }

    const itemsResult = this.validateEachItem(parsedResult.parsed);
    if (!itemsResult.success) {
      return { success: false, error: itemsResult.error };
    }

    return { success: true, value: parsedResult.parsed as PriceData[] };
  }

  private parseJSONContent(content: string): {
    parsed?: unknown;
    error?: ValidationError;
  } {
    try {
      return { parsed: JSON.parse(content) };
    } catch {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'Invalid JSON format',
          details: {},
        },
      };
    }
  }

  private validateJSONStructure(
    parsed: unknown
  ): Result<void, ValidationError> {
    if (!Array.isArray(parsed)) {
      return {
        success: false,
        error: {
          type: 'INVALID_VALUES',
          message: 'JSON must be an array of price data',
          details: {},
        },
      };
    }
    return { success: true, value: undefined };
  }

  private validateEachItem(parsed: unknown): Result<void, ValidationError> {
    for (const item of parsed as unknown[]) {
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
          success: false,
          error: {
            type: 'INVALID_VALUES',
            message: 'Each item must have date, open, high, low, close, volume',
            details: {},
          },
        };
      }
    }
    return { success: true, value: undefined };
  }

  validateAndParse(content: string, filename: string): ParseResult {
    const parseResult = this.parseByFormat(content, filename);
    if (!parseResult.success) {
      return { success: false, error: parseResult.error };
    }
    const data = parseResult.value;

    const duplicatesResult = this.checkForDuplicates(data);
    if (!duplicatesResult.success) {
      return { success: false, error: duplicatesResult.error };
    }

    const invalidResult = this.validateAllCandles(data);
    if (!invalidResult.success) {
      return { success: false, error: invalidResult.error };
    }

    const orderingResult = this.checkOrdering(data);
    if (!orderingResult.success) {
      return { success: false, error: orderingResult.error };
    }

    const warningsResult = this.detectTimeframeAndGaps(data);

    return {
      success: true,
      value: {
        data,
        warnings: warningsResult.warnings,
        detectedTimeframe: warningsResult.detectedTimeframe,
      },
    };
  }

  private parseByFormat(
    content: string,
    filename: string
  ): Result<PriceData[], ValidationError> {
    if (filename.endsWith('.csv')) {
      return this.parseCSV(content);
    } else if (filename.endsWith('.json')) {
      return this.parseJSON(content);
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
  }

  private checkForDuplicates(data: PriceData[]): Result<void, ValidationError> {
    const duplicates = this.checkDuplicates(data);
    if (duplicates.length > 0) {
      return {
        success: false,
        error: {
          type: 'DUPLICATE_TIMESTAMP',
          message: `Duplicate timestamps found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}`,
          details: { values: duplicates.map((d) => ({ date: d })) },
        },
      };
    }
    return { success: true, value: undefined };
  }

  private validateAllCandles(data: PriceData[]): Result<void, ValidationError> {
    const invalidRows: { row: number; error: string }[] = [];
    for (let i = 0; i < data.length; i++) {
      const validation = this.validateCandle(data[i]);
      if (!validation.success) {
        invalidRows.push({ row: i + 1, error: validation.error });
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
            rows: invalidRows.map((r) => r.row),
            values: firstFew.map((r) => ({ row: r.row, error: r.error })),
          },
        },
      };
    }
    return { success: true, value: undefined };
  }

  private checkOrdering(data: PriceData[]): Result<void, ValidationError> {
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
    return { success: true, value: undefined };
  }

  private detectTimeframeAndGaps(data: PriceData[]): {
    warnings: string[];
    detectedTimeframe: TimeframeType;
  } {
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

    return { warnings, detectedTimeframe: tf };
  }
}

export function validateAndParse(
  content: string,
  filename: string
): ParseResult {
  const validator = new DataValidator();
  return validator.validateAndParse(content, filename);
}
