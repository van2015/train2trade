import { describe, expect, it } from 'vitest'
import { Timeframe } from '@/domain/candles/timeframe'
import { ReplayError } from '@/domain/replay/replayEngine'
import {
  MAX_REPLAY_INTERVAL_MS,
  MIN_REPLAY_INTERVAL_MS,
  REPLAY_SPEEDS,
  replayIntervalMs,
} from '@/domain/replay/speed'

describe('replayIntervalMs — velocidad en tiempo real (§7B)', () => {
  it('1× = duración real de la vela (reproducción a velocidad normal)', () => {
    expect(replayIntervalMs(Timeframe.HOUR, 1)).toBe(Timeframe.HOUR.ms)
    expect(replayIntervalMs(Timeframe.MINUTE, 1)).toBe(Timeframe.MINUTE.ms)
  })

  it('0.5× duplica el intervalo y 60× lo divide entre 60', () => {
    expect(replayIntervalMs(Timeframe.MINUTE, 0.5)).toBe(Timeframe.MINUTE.ms * 2)
    expect(replayIntervalMs(Timeframe.MINUTE, 60)).toBe(Timeframe.MINUTE.ms / 60)
  })

  it('acota por abajo (16 ms) y por arriba (1 h)', () => {
    expect(replayIntervalMs(Timeframe.MINUTE, 1e9)).toBe(MIN_REPLAY_INTERVAL_MS)
    expect(replayIntervalMs(Timeframe.HOUR, 0.5)).toBe(MAX_REPLAY_INTERVAL_MS) // 2 h > tope
    expect(replayIntervalMs(Timeframe.MINUTE, 0.001)).toBe(MAX_REPLAY_INTERVAL_MS)
  })

  it('los presets (0.5×–3600×) producen intervalos finitos dentro de los límites', () => {
    expect(REPLAY_SPEEDS).toEqual([0.5, 1, 10, 60, 600, 3600])
    for (const speed of REPLAY_SPEEDS) {
      const interval = replayIntervalMs(Timeframe.MINUTE, speed)
      expect(Number.isFinite(interval)).toBe(true)
      expect(interval).toBeGreaterThanOrEqual(MIN_REPLAY_INTERVAL_MS)
      expect(interval).toBeLessThanOrEqual(MAX_REPLAY_INTERVAL_MS)
    }
  })

  it('speed no finita o ≤ 0 → ReplayError (sin NaN)', () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => replayIntervalMs(Timeframe.HOUR, speed)).toThrow(ReplayError)
    }
  })
})
