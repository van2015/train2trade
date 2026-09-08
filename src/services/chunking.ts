import { PriceData } from '../types/asset';

export const CHUNK_SIZE = 500;

export interface Chunk {
  timemili: number;
  endTime: number;
  samples: PriceData[];
}

export function splitIntoChunks(data: PriceData[], chunkSize: number = CHUNK_SIZE): Chunk[] {
  if (data.length === 0) return [];

  const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const chunks: Chunk[] = [];

  for (let i = 0; i < sorted.length; i += chunkSize) {
    const samples = sorted.slice(i, i + chunkSize);
    chunks.push({
      timemili: new Date(samples[0].date).getTime(),
      endTime: new Date(samples[samples.length - 1].date).getTime(),
      samples,
    });
  }

  return chunks;
}
