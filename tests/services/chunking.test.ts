import { describe, it, expect } from 'vitest';
import { PriceData } from '../../src/types/asset';
import { splitIntoChunks } from '../../src/services/chunking';

const START = Date.parse('2024-01-01T00:00:00Z');
const MINUTE = 60 * 1000;

function buildData(count: number): PriceData[] {
  const data: PriceData[] = [];
  for (let i = 0; i < count; i++) {
    data.push({
      date: new Date(START + i * MINUTE).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000,
    });
  }
  return data;
}

describe('splitIntoChunks', () => {
  it('splits data into chunks of up to 500 samples', () => {
    const chunks = splitIntoChunks(buildData(1000));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].samples).toHaveLength(500);
    expect(chunks[1].samples).toHaveLength(500);
  });

  it('returns a single chunk when data is under the limit', () => {
    const chunks = splitIntoChunks(buildData(300));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].samples).toHaveLength(300);
  });

  it('returns empty for empty data', () => {
    expect(splitIntoChunks([])).toEqual([]);
  });

  it('computes timemili and endTime from the chunk boundaries', () => {
    const chunks = splitIntoChunks(buildData(1000));
    expect(chunks[0].timemili).toBe(START);
    expect(chunks[0].endTime).toBe(START + 499 * MINUTE);
    expect(chunks[1].timemili).toBe(START + 500 * MINUTE);
    expect(chunks[1].endTime).toBe(START + 999 * MINUTE);
  });

  it('sorts unsorted data chronologically', () => {
    const unsorted = buildData(600).reverse();
    const chunks = splitIntoChunks(unsorted);
    expect(chunks[0].timemili).toBe(START);
  });
});
