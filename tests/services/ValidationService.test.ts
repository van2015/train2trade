import { describe, it, expect } from 'vitest';
import { validateAndParse } from '../../src/services/ValidationService';

describe('ValidationService', () => {
  describe('CSV parsing', () => {
    it('parses valid CSV with all required fields', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].open).toBe(100);
      expect(result.data![0].high).toBe(105);
    });

    it('rejects CSV missing required field', () => {
      const csv = `date,open,high,close,volume
2024-01-01T00:00:00Z,100,105,102,1000`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Missing required field');
    });

    it('accepts CSV with exactly 2 rows', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
    });

    it('rejects CSV with only header', () => {
      const csv = `date,open,high,low,close,volume`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
    });

    it('rejects CSV with only header', () => {
      const csv = `date,open,high,low,close,volume`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
    });

    it('ignores malformed rows', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
malformed row
2024-01-01T00:02:00Z,100,105,98,102,1000`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('handles CSV with extra columns', () => {
      const csv = `date,open,high,low,close,volume,extra
2024-01-01T00:00:00Z,100,105,98,102,1000,ignored
2024-01-01T00:01:00Z,102,108,100,105,1200,ignored`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('JSON parsing', () => {
    it('parses valid JSON array', () => {
      const json = JSON.stringify([
        { date: '2024-01-01T00:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 },
        { date: '2024-01-01T00:01:00Z', open: 102, high: 108, low: 100, close: 105, volume: 1200 },
      ]);
      const result = validateAndParse(json, 'data.json');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('rejects invalid JSON', () => {
      const json = `{ not valid json`;
      const result = validateAndParse(json, 'data.json');
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Invalid JSON format');
    });

    it('rejects non-array JSON root', () => {
      const json = JSON.stringify({ date: '2024-01-01T00:00:00Z', open: 100, high: 105, low: 98, close: 102, volume: 1000 });
      const result = validateAndParse(json, 'data.json');
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('JSON must be an array of price data');
    });

    it('rejects JSON array with missing fields', () => {
      const json = JSON.stringify([
        { date: '2024-01-01T00:00:00Z', open: 100, high: 105 },
      ]);
      const result = validateAndParse(json, 'data.json');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Each item must have date, open, high, low, close, volume');
    });
  });

  describe('Data validation', () => {
    it('rejects negative open price', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,-100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Negative price value');
    });

    it('rejects negative high price', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,-105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Negative price value');
    });

    it('rejects negative low price', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,-98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Negative price value');
    });

    it('rejects negative close price', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,-102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Negative price value');
    });

    it('rejects high less than low', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,98,105,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('High is less than Low');
    });

    it('rejects duplicate timestamps', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:00:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('DUPLICATE_TIMESTAMP');
      expect(result.error?.message).toContain('Duplicate timestamps found');
    });

    it('rejects unordered timestamps', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:01:00Z,100,105,98,102,1000
2024-01-01T00:00:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('UNORDERED');
      expect(result.error?.message).toContain('Data is not ordered by date');
    });

    it('rejects NaN values', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,NaN,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid number');
    });

    it('rejects Infinity values', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,Infinity,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid number');
    });

    it('rejects invalid volume (NaN)', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,NaN
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid volume');
    });
  });

  describe('Warnings', () => {
    it('returns warning when gaps detected', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200
2024-01-01T00:05:00Z,102,108,100,105,1200
2024-01-01T00:06:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('gaps'))).toBe(true);
    });

    it('returns warning when timeframe confidence is low', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T01:00:00Z,102,108,100,105,1200
2024-01-01T05:00:00Z,102,108,100,105,1200
2024-01-01T12:00:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('Could not detect timeframe'))).toBe(true);
    });

    it('returns empty warnings array for clean data', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200
2024-01-01T00:02:00Z,104,110,102,106,1300`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('includes detectedTimeframe in result', () => {
      const csv = `date,open,high,low,close,volume
2024-01-01T00:00:00Z,100,105,98,102,1000
2024-01-01T00:01:00Z,102,108,100,105,1200`;
      const result = validateAndParse(csv, 'data.csv');
      expect(result.success).toBe(true);
      expect(result.detectedTimeframe).toBe('1m');
    });
  });
});
