import { useCallback, useState } from 'react'
import type { TestForwardSession } from '@/domain/testforward/session'

/** Sesiones en curso (replay y test-forward): el gráfico solo ve lo consumido
 * (§7B/§2.3) y solo manda una a la vez. En cualquier callback, `null` =
 * sesión descartada (cambio de velas u otra sesión en marcha). */
export interface ActiveSessionsSlice {
  activeCursor: number | null
  hasTestForward: boolean
  tfSession: TestForwardSession | null
  onReplayProgress: (cursor: number | null) => void
  onTfStart: (session: TestForwardSession) => void
  onTfProgress: (cursor: number | null) => void
}

export interface UseActiveSessionsOptions {
  /** Sesión de test-forward iniciada (App la enlaza con `nav.openTestForward`). */
  onSessionStarted: () => void
}

/**
 * Exclusión mutua: una sesión de replay nueva (cursor no nulo) descarta la de
 * test-forward y viceversa. `onReplayProgress` conserva identidad estable:
 * `ReplayPanel` la usa en las deps de sus `useEffect` (temporizador).
 */
export function useActiveSessions({
  onSessionStarted,
}: UseActiveSessionsOptions): ActiveSessionsSlice {
  const [replayCursor, setReplayCursor] = useState<number | null>(null)
  const [tfSession, setTfSession] = useState<TestForwardSession | null>(null)
  const [tfCursor, setTfCursor] = useState<number | null>(null)

  const onReplayProgress = useCallback((cursor: number | null) => {
    setReplayCursor(cursor)
    if (cursor !== null) {
      setTfSession(null)
      setTfCursor(null)
    }
  }, [])

  const onTfStart = (session: TestForwardSession) => {
    setTfSession(session)
    setTfCursor(session.cursor)
    setReplayCursor(null)
    onSessionStarted()
  }

  const onTfProgress = (cursor: number | null) => {
    if (cursor === null) {
      setTfSession(null)
      setTfCursor(null)
      return
    }
    setTfCursor(cursor)
  }

  return {
    activeCursor: replayCursor ?? tfCursor,
    hasTestForward: tfSession !== null,
    tfSession,
    onReplayProgress,
    onTfStart,
    onTfProgress,
  }
}
