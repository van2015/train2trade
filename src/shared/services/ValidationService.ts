import { PriceData } from '../types/asset';
import { Timeframe, Timeframe as TimeframeType } from '../../backtest/timeframe/Timeframe';

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

  private validateCandle(candle: PriceData): { valid: boolean; error?: string } {
    const negativeError = this.checkForNegativePrices(candle);
    if (negativeError) return negativeError;

    const invalidNumberError = this.checkForInvalidNumbers(candle);
    if (invalidNumberError) return invalidNumberError;

    const volumeError = this.checkForInvalidVolume(candle);
    if (volumeError) return volumeError;

    const highLowError = this.checkHighLowConsistency(candle);
    if (highLowError) return highLowError;

    return { valid: true };
  }

  private checkForNegativePrices(candle: PriceData): { valid: boolean; error?: string } | undefined {
    if (candle.open < 0 || candle.high < 0 || candle.low < 0 || candle.close < 0) {
      return { valid: false, error: 'Negative price value' };
    }
    return undefined;
  }

  private checkForInvalidNumbers(candle: PriceData): { valid: boolean; error?: string } | undefined {
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
    return undefined;
  }

  private checkForInvalidVolume(candle: PriceData): { valid: boolean; error?: string } | undefined {
    if (isNaN(candle.volume) || !isFinite(candle.volume)) {
      return { valid: false, error: 'Invalid volume' };
    }
    return undefined;
  }

  private checkHighLowConsistency(candle: PriceData): { valid: boolean; error?: string } | undefined {
    if (candle.high < candle.low) {
      return { valid: false, error: 'High is less than Low' };
    }
    return undefined;
  }

  private parseCSV(content: string): { data?: PriceData[]; error?: ValidationError } {
    const lines = content.trim().split('\n');

    const headerError = this.validateHeaderExists(lines);
    if (headerError) return headerError;

    const headerResult = this.parseHeaderIndices(lines[0]);
    if (headerResult.error) {
      return { error: headerResult.error };
    }
    const headerIndices = headerResult.indices;

    if (!headerIndices) {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'Header indices not found',
          details: {},
        },
      };
    }

    const dataResult = this.parseDataRows(lines, headerIndices);
    if (dataResult.error) {
      return { error: dataResult.error };
    }

    return { data: dataResult.data };
  }

  private validateHeaderExists(lines: string[]): { error?: ValidationError } | undefined {
    if (lines.length < 2) {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'CSV must have header and at least one data row',
          details: {},
        },
      };
    }
    return undefined;
  }

  private parseHeaderIndices(headerLine: string): { indices?: Record<string, number>; error?: ValidationError } {
    const header = headerLine.toLowerCase().split(',').map(h => h.trim());
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

    return { indices: headerIndices };
  }

  private parseDataRows(lines: string[], headerIndices: Record<string, number>): { data?: PriceData[]; error?: ValidationError } {
    const data: PriceData[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length !== lines[0].split(',').length) continue;

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

  private parseJSON(content: string): { data?: PriceData[]; error?: ValidationError } {
    const parsedResult = this.parseJSONContent(content);
    if (parsedResult.error) {
      return { error: parsedResult.error };
    }

    const arrayResult = this.validateJSONStructure(parsedResult.parsed);
    if (arrayResult.error) {
      return { error: arrayResult.error };
    }

    const itemsResult = this.validateEachItem(parsedResult.parsed);
    if (itemsResult.error) {
      return { error: itemsResult.error };
    }

    return { data: parsedResult.parsed as PriceData[] };
  }

  private parseJSONContent(content: string): { parsed?: unknown; error?: ValidationError } {
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

  private validateJSONStructure(parsed: unknown): { error?: ValidationError } {
    if (!Array.isArray(parsed)) {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'JSON must be an array of price data',
          details: {},
        },
      };
    }
    return {};
  }

  private validateEachItem(parsed: unknown): { error?: ValidationError } {
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
          error: {
            type: 'INVALID_VALUES',
            message: 'Each item must have date, open, high, low, close, volume',
            details: {},
          },
        };
      }
    }
    return {};
  }

  validateAndParse(content: string, filename: string): ParseResult {
    const parseResult = this.parseByFormat(content, filename);
    if (parseResult.error) {
      return { success: false, error: parseResult.error };
    }
    const data = parseResult.data!;

    const duplicatesResult = this.checkForDuplicates(data);
    if (duplicatesResult.error) {
      return { success: false, error: duplicatesResult.error };
    }

    const invalidResult = this.validateAllCandles(data);
    if (invalidResult.error) {
      return { success: false, error: invalidResult.error };
    }

    const orderingResult = this.checkOrdering(data);
    if (orderingResult.error) {
      return { success: false, error: orderingResult.error };
    }

    const warningsResult = this.detectTimeframeAndGaps(data);

    return {
      success: true,
      data,
      warnings: warningsResult.warnings,
      detectedTimeframe: warningsResult.detectedTimeframe,
    };
  }

  private parseByFormat(content: string, filename: string): { data?: PriceData[]; error?: ValidationError } {
    if (filename.endsWith('.csv')) {
      return this.parseCSV(content);
    } else if (filename.endsWith('.json')) {
      return this.parseJSON(content);
    } else {
      return {
        error: {
          type: 'INVALID_VALUES',
          message: 'Unsupported file format. Use CSV or JSON.',
          details: {},
        },
      };
    }
  }

  private checkForDuplicates(data: PriceData[]): { error?: ValidationError } {
    const duplicates = this.checkDuplicates(data);
    if (duplicates.length > 0) {
      return {
        error: {
          type: 'DUPLICATE_TIMESTAMP',
          message: `Duplicate timestamps found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}`,
          details: { values: duplicates.map(d => ({ date: d })) },
        },
      };
    }
    return {};
  }

  private validateAllCandles(data: PriceData[]): { error?: ValidationError } {
    const invalidRows: { row: number; error: string }[] = [];
    for (let i = 0; i < data.length; i++) {
      const validation = this.validateCandle(data[i]);
      if (!validation.valid) {
        invalidRows.push({ row: i + 1, error: validation.error! });
      }
    }

    if (invalidRows.length > 0) {
      const firstFew = invalidRows.slice(0, 3);
      return {
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
    return {};
  }

  private checkOrdering(data: PriceData[]): { error?: ValidationError } {
    for (let i = 1; i < data.length; i++) {
      const prevTime = new Date(data[i - 1].date).getTime();
      const currTime = new Date(data[i].date).getTime();
      if (currTime < prevTime) {
        return {
          error: {
            type: 'UNORDERED',
            message: `Data is not ordered by date. Found row ${i + 1} with timestamp before row ${i}.`,
            details: { rows: [i, i + 1] },
          },
        };
      }
    }
    return {};
  }

  private detectTimeframeAndGaps(data: PriceData[]): { warnings: string[]; detectedTimeframe?: TimeframeType } {
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

export function validateAndParse(content: string, filename: string): ParseResult {
  const validator = new DataValidator();
  return validator.validateAndParse(content, filename);
}
