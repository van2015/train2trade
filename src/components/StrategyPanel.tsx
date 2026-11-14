import { useState } from 'react'
import { Candle } from '@/domain/candles/candle'
import { canonicalHash, strategyFingerprint } from '@/domain/strategies/fingerprint'
import { buildStrategy, StrategySpec } from '@/domain/strategies/spec'
import {
  DEMO_STRATEGY_SPEC,
  StrategyRepository,
  StrategySnapshot,
} from '@/storage/strategyRepository'
import { StrategyEditor } from './StrategyEditor'

export interface StrategyPanelProps {
  /** Estrategias persistidas (snapshot con `id`), en el orden del repositorio. */
  strategies: readonly StrategySnapshot[]
  /** Repositorio inyectado (mismo patrón que el resto de paneles). */
  repository: StrategyRepository
  /** Velas cargadas: el editor las usa para el aviso de niveles invertidos. */
  candles: readonly Candle[]
  /** Tras guardar/borrar: el padre refresca la lista (y la selección cae a la primera). */
  onChange: () => void
}

/** Plantilla de "Nueva": estructura de la demo con `name` vacío (enmienda 16). */
const TEMPLATE: StrategySpec = { ...DEMO_STRATEGY_SPEC, name: '' }

type Editing = { original: StrategySnapshot | null; spec: StrategySpec }

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Copia de trabajo sin `id` (el `id` es la clave hash y se recalcula al guardar). */
function toDraft(snapshot: StrategySnapshot): StrategySpec {
  const { id, ...draft } = snapshot
  void id
  return draft
}

/** Huella visible: la misma que registra un `Experiment` (fallback: hash del spec). */
function fingerprintOf(snapshot: StrategySnapshot): string {
  try {
    return strategyFingerprint(buildStrategy(snapshot))
  } catch {
    return canonicalHash(snapshot)
  }
}

/**
 * Panel de estrategias (§1.8): **CRUD puro** — lista `name@version` + huella
 * con Nueva / Editar / Borrar. El selector único de ejecución vive en la
 * sección Experimentos (§1.9). Al guardar, la versión nueva la asigna el panel
 * con `nextVersion` conservando la anterior (enmienda 13); sin cambios respecto
 * al original no se crea versión.
 */
export function StrategyPanel({ strategies, repository, candles, onChange }: StrategyPanelProps) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openNew = () => {
    setEditing({ original: null, spec: TEMPLATE })
    setError(null)
  }

  const openEdit = (snapshot: StrategySnapshot) => {
    setEditing({ original: snapshot, spec: toDraft(snapshot) })
    setError(null)
  }

  const close = () => {
    setEditing(null)
    setError(null)
  }

  const handleSave = (draft: StrategySpec) => {
    if (editing === null) return
    try {
      // ¿El contenido ya está guardado tal cual? (sin cambios al editar, o
      // recreación exacta de una existente) → no se crea versión nueva.
      const direct = repository.find(canonicalHash(draft))
      const alreadyStored =
        direct !== null && (editing.original === null || direct.id === editing.original.id)
      const spec = alreadyStored ? draft : { ...draft, version: repository.nextVersion(draft.name) }
      // §1.8: forma (parse) + semántica (clases/aliases) antes de persistir.
      buildStrategy(spec)
      if (!alreadyStored) repository.save(spec)
      close()
      onChange()
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  const handleRemove = (snapshot: StrategySnapshot) => {
    repository.remove(snapshot.id)
    onChange()
  }

  return (
    <section className="strategy-panel" aria-label="Estrategias">
      <h2 className="panel-title">Estrategias</h2>

      {editing !== null ? (
        <StrategyEditor
          title={
            editing.original === null
              ? 'Crear estrategia'
              : `Editar ${editing.original.name}@${editing.original.version}`
          }
          spec={editing.spec}
          candles={candles}
          error={error}
          onSave={handleSave}
          onCancel={close}
        />
      ) : (
        <>
          {strategies.length === 0 ? (
            <p className="panel-hint" data-testid="strategy-empty">
              Sin estrategias: crea una desde cero con "Nueva estrategia".
            </p>
          ) : (
            <div className="panel-scroll">
              <table className="lab-table" data-testid="strategy-list">
                <thead>
                  <tr>
                    <th scope="col">Estrategia</th>
                    <th scope="col">Huella</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>
                        {snapshot.name}@{snapshot.version}
                      </td>
                      <td>{fingerprintOf(snapshot)}</td>
                      <td>
                        <div className="panel-actions">
                          <button
                            type="button"
                            className="button"
                            aria-label={`Editar ${snapshot.name}@${snapshot.version}`}
                            onClick={() => openEdit(snapshot)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="button"
                            aria-label={`Borrar ${snapshot.name}@${snapshot.version}`}
                            onClick={() => handleRemove(snapshot)}
                          >
                            Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel-actions">
            <button type="button" className="button" onClick={openNew}>
              Nueva estrategia
            </button>
          </div>
        </>
      )}
    </section>
  )
}
