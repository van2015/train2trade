import { Candle } from '@/domain/candles/candle'
import { Timeframe } from '@/domain/candles/timeframe'
import { TradingSessionConfig } from '@/domain/trading/tradingSession'
import { crossStrategy } from './strategies'

/**
 * Config por defecto de las sesiones E2E (replay/backtest): cruce SMA(2)/SMA(3),
 * velas dadas, timeframe de 1 hora y capital inicial de 1 000.
 */
export function baseConfig(
  candles: readonly Candle[],
  overrides: Partial<TradingSessionConfig> = {},
): TradingSessionConfig {
  return {
    strategy: crossStrategy(),
    candles,
    timeframe: Timeframe.HOUR,
    initialCapital: 1_000,
    ...overrides,
  }
}
