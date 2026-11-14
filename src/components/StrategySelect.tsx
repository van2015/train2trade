import type { StrategySnapshot } from '@/storage/strategyRepository'

export interface StrategySelectProps {
  /** Estrategias persistidas (con su `id` de clave). */
  strategies: readonly StrategySnapshot[]
  /** Selección activa; si no existe (o `null`) se muestra la primera. */
  selectedId: string | null
  /** Cambia la estrategia activa del laboratorio (por `id`). */
  onChange: (id: string) => void
}

/**
 * Selector único de la estrategia activa (§1.9): vive en la sección
 * "Experimentos" del sidebar y **todos los paneles comparten la selección**
 * (un solo estado en `App`; cambiar aquí cambia la estrategia con la que
 * ejecutan Backtest, Replay, Test-Forward y Optimización).
 */
export function StrategySelect({ strategies, selectedId, onChange }: StrategySelectProps) {
  const first = strategies[0]
  if (strategies.length === 0 || first === undefined) {
    return (
      <p className="panel-hint" data-testid="strategy-select-empty">
        Sin estrategias: la demo se restaura al recargar, o crea una desde cero.
      </p>
    )
  }

  const value = strategies.some((strategy) => strategy.id === selectedId)
    ? (selectedId as string)
    : first.id

  return (
    <label className="field">
      <span>Estrategia</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {strategies.map((strategy) => (
          <option key={strategy.id} value={strategy.id}>
            {strategy.name}@{strategy.version}
          </option>
        ))}
      </select>
    </label>
  )
}
