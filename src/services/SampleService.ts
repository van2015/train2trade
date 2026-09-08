import { PriceData, SampleIndex } from '../types/asset';
import { AssetChartRepository } from './AssetChartRepository';
import { IndexedDbAssetChartRepository } from './IndexedDbAssetChartRepository';

class SampleService {
  private static instance: SampleService;

  constructor(private readonly repo: AssetChartRepository) {}

  static getInstance(): SampleService {
    if (!SampleService.instance) {
      SampleService.instance = new SampleService(IndexedDbAssetChartRepository.getInstance());
    }
    return SampleService.instance;
  }

  getChunkIndexes(assetId: string): Promise<SampleIndex[]> {
    return this.repo.getChunkIndexes(assetId);
  }

  async range(assetId: string, from: number, to: number): Promise<PriceData[]> {
    const indexes = await this.repo.getChunkIndexes(assetId);
    const overlapping = indexes.filter(i => i.endTime >= from && i.timemili <= to);
    const result: PriceData[] = [];

    for (const index of overlapping) {
      const samples = await this.repo.getChunkSamples(assetId, index.timemili);
      for (const sample of samples) {
        const time = new Date(sample.date).getTime();
        if (time >= from && time <= to) {
          result.push(sample);
        }
      }
    }

    return result;
  }

  async next(assetId: string, time: number): Promise<PriceData[]> {
    const indexes = await this.repo.getChunkIndexes(assetId);
    const nextIndex = indexes.find(i => i.timemili > time);
    if (!nextIndex) return [];
    return this.repo.getChunkSamples(assetId, nextIndex.timemili);
  }

  async before(assetId: string, time: number): Promise<PriceData[]> {
    const indexes = await this.repo.getChunkIndexes(assetId);
    const prevIndex = indexes.filter(i => i.endTime < time).pop();
    if (!prevIndex) return [];
    return this.repo.getChunkSamples(assetId, prevIndex.timemili);
  }

  async last(assetId: string): Promise<PriceData[]> {
    const indexes = await this.repo.getChunkIndexes(assetId);
    if (indexes.length === 0) return [];
    return this.repo.getChunkSamples(assetId, indexes[indexes.length - 1].timemili);
  }
}

export { SampleService };
