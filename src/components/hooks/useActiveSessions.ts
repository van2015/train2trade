import { useCallback, useState } from 'react'
import type { TestForwardSession } from '@/domain/testforward/session'

/**
 * Sesiones en curso (replay y test-forward): el gráfico solo ve lo consumido
 * (§7B/§2.3) y solo manda una a la vez.
 */
export interface ActiveSessionsSlice {
  /** Cursor de la sesión activa (`replay ?? test-forward`); null = sin recorte. */
  activeCursor: number | null
  /** true → hay sesión de test-forward en curso (punto en su pestaña). */
  hasTestForward: boolean
  tfSession: TestForwardSession | null
  /** Cursor del replay; null = descartada (cambio de velas) o sin sesión. */
  onReplayProgress: (cursor: number | null) => void
  /** Nueva sesión (§2.3): corta el gráfico, olvida el cursor del replay y notifica. */
  onTfStart: (session: TestForwardSession) => void
  /** Cursor de la sesión de test-forward; null = descartada (velas nuevas). */
  onTfProgress: (cursor: number | null) => void
}

export interface UseActiveSessionsOptions {
  /** Sesión de test-forward iniciada: corta el replay y abre su pestaña. */
  onSessionStarted: () => void
}

/**
 * Exclusión mutua de sesiones: una sesión de replay nueva (cursor no nulo)
 * descarta la de test-forward y viceversa — el gráfico sigue a una sola.
 * `onReplayProgress` conserva identidad estable: `ReplayPanel` lo usa en las
 * deps de sus `useEffect` (temporizador de reproducción).
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
