import type { IndicatorSettings, IndicatorToggle } from './chartData'

export interface IndicatorPanelProps {
  settings: IndicatorSettings
  onChange: (settings: IndicatorSettings) => void
}

interface IndicatorRow {
  key: keyof IndicatorSettings
  label: string
  hint: string
}

const ROWS: readonly IndicatorRow[] = [
  { key: 'sma', label: 'SMA', hint: 'Media móvil simple' },
  { key: 'ema', label: 'EMA', hint: 'Media móvil exponencial' },
  { key: 'rsi', label: 'RSI', hint: 'Índice de fuerza relativa (panel inferior)' },
]

function clampPeriod(raw: string): number | null {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return null
  return value
}

/**
 * Panel de activación y configuración de los indicadores del gráfico.
 * Los periodos se validan aquí (entero >= 1) para que `buildLines` nunca reciba
 * un valor que hiciera fallar al indicador del dominio.
 */
export function IndicatorPanel({ settings, onChange }: IndicatorPanelProps) {
  const update = (key: keyof IndicatorSettings, patch: Partial<IndicatorToggle>) => {
    onChange({ ...settings, [key]: { ...settings[key], ...patch } })
  }

  return (
    <section className="indicator-panel" aria-label="Indicadores">
      <h2 className="panel-title">Indicadores</h2>
      {ROWS.map((row) => {
        const toggle = settings[row.key]
        return (
          <div className="indicator-row" key={row.key}>
            <label className="indicator-row__label">
              <input
                type="checkbox"
                checked={toggle.enabled}
                onChange={(event) => update(row.key, { enabled: event.target.checked })}
              />
              <span className="indicator-row__name">{row.label}</span>
              <span className="indicator-row__hint">{row.hint}</span>
            </label>
            <label className="indicator-row__period">
              <span className="sr-only">Periodo de {row.label}</span>
              <input
                type="number"
                min={1}
                step={1}
                value={toggle.period}
                disabled={!toggle.enabled}
                onChange={(event) => {
                  const period = clampPeriod(event.target.value)
                  if (period !== null) update(row.key, { period })
                }}
              />
            </label>
          </div>
        )
      })}
    </section>
  )
}
