import { AssetSummary, PriceData } from '../../types/asset';
import { Timeframe } from '../../../backtest/timeframe/Timeframe';

export interface AssetChartRepository {
  init(): Promise<void>;
  saveAsset(name: string, data: PriceData[], originalTimeframe: Timeframe): Promise<AssetSummary>;
  getAssetSummaries(): Promise<AssetSummary[]>;
  getAssetData(id: string): Promise<PriceData[]>;
  deleteAsset(id: string): Promise<void>;
  getSamplesRange(assetId: string, from: number, to: number): Promise<PriceData[]>;
  getSampleAfter(assetId: string, time: number): Promise<PriceData | null>;
  getSampleBefore(assetId: string, time: number): Promise<PriceData | null>;
  getLastSample(assetId: string): Promise<PriceData | null>;
}
