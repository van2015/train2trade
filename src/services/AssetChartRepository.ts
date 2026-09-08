import { AssetSummary, PriceData, SampleIndex } from '../types/asset';
import { Timeframe } from '../timeframe/Timeframe';

export interface AssetChartRepository {
  init(): Promise<void>;
  saveAsset(name: string, data: PriceData[], originalTimeframe: Timeframe): Promise<AssetSummary>;
  getAssetSummaries(): Promise<AssetSummary[]>;
  getAssetData(id: string): Promise<PriceData[]>;
  deleteAsset(id: string): Promise<void>;
  getChunkIndexes(assetId: string): Promise<SampleIndex[]>;
  getChunkSamples(assetId: string, timemili: number): Promise<PriceData[]>;
}
