import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ExperimentHistoryPanel } from '@/components/ExperimentHistoryPanel'
import { ExperimentSnapshot } from '@/domain/backtest/experiment'
import { Metrics } from '@/domain/backtest/metrics'
import { formatChartTime } from '@/components/chartData'

const t0 = 1_700_000_000_000
const stepMs = 60_000

const BASE_METRICS: Metrics = {
  netProfit: 100,
  roi: 0.1,
  maxDrawdown: 0.02,
  sharpe: 1.2,
  profitFactor: 2,
  winRate: 0.5,
  avgTrade: 10,
  expectancy: 5,
}

function snapshot(overrides: Partial<ExperimentSnapshot> = {}): ExperimentSnapshot {
  return {
    id: 'aaa',
    strategyId: 'sma-cross@1',
    fingerprint: 'deadbeef',
    instrument: 'BTC/USDT',
    timeframe: '1h',
    period: { from: t0, to: t0 + 8 * stepMs },
    initialCapital: 1_000,
    execution: { slippageBps: 0, feeBps: 0 },
    risk: { maxPositionFraction: 1, minCashReserve: 0, feeBps: 0, slippageBps: 0 },
    metrics: { ...BASE_METRICS },
    finalEquity: 1_100,
    equityCurve: [{ time: t0, equity: 1_000 }],
    trades: [],
    ...overrides,
  }
}

function renderPanel(
  snapshots: readonly ExperimentSnapshot[] = [snapshot()],
  onRemove = vi.fn<(ids: readonly string[]) => void>(),
  onClear = vi.fn<() => void>(),
) {
  const view = render(
    <ExperimentHistoryPanel snapshots={snapshots} onRemove={onRemove} onClear={onClear} />,
  )
  return { ...view, onRemove, onClear }
}

function selectCheckbox(index: number): void {
  fireEvent.click(screen.getAllByRole('checkbox')[index]!)
}

function comparisonRowTexts(): string[] {
  const table = screen.getByTestId('history-comparison')
  return within(table)
    .getAllByRole('row')
    .slice(1) // sin la cabecera
    .map((row) => row.textContent ?? '')
}

describe('ExperimentHistoryPanel — listado', () => {
  it('sin experimentos → aviso y acciones deshabilitadas', () => {
    renderPanel([])

    expect(screen.getByTestId('history-empty')).toHaveTextContent('Sin experimentos')
    expect(screen.queryByTestId('history-table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Borrar selección' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Borrar todo' })).toBeDisabled()
  })

  it('lista cada experimento con estrategia, instrumento, timeframe, periodo y ROI', () => {
    renderPanel([
      snapshot(),
      snapshot({
        id: 'bbb',
        strategyId: 'otra@2',
        instrument: null,
        timeframe: '4h',
        metrics: { ...BASE_METRICS, roi: 0.25 },
      }),
    ])

    const table = screen.getByTestId('history-table')
    expect(table).toHaveTextContent('sma-cross@1')
    expect(table).toHaveTextContent('BTC/USDT')
    expect(table).toHaveTextContent('otra@2')
    expect(table).toHaveTextContent('4h')
    expect(table).toHaveTextContent('10.00%')
    expect(table).toHaveTextContent('25.00%')
    expect(table).toHaveTextContent(formatChartTime(t0))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
})

describe('ExperimentHistoryPanel — comparación (§9)', () => {
  it('sin selección o con una sola no hay tabla comparada', () => {
    renderPanel()
    expect(screen.queryByTestId('history-comparison')).not.toBeInTheDocument()

    selectCheckbox(0)
    expect(screen.queryByTestId('history-comparison')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Borrar selección' })).toBeEnabled()
  })

  it('con dos seleccionados → tabla comparada y aviso de differences', () => {
    renderPanel([
      snapshot({ id: 'a' }),
      snapshot({ id: 'b', timeframe: '4h', metrics: { ...BASE_METRICS, netProfit: 50 } }),
    ])
    selectCheckbox(0)
    selectCheckbox(1)

    expect(screen.getByTestId('history-comparison')).toBeInTheDocument()
    expect(screen.getByTestId('history-differences')).toHaveTextContent('Timeframe')
    expect(comparisonRowTexts()).toHaveLength(2)
  })

  it('sin diferencias no aparece el aviso (misma config de ejecución)', () => {
    renderPanel([snapshot({ id: 'a' }), snapshot({ id: 'b', strategyId: 'beta@1' })])
    selectCheckbox(0)
    selectCheckbox(1)

    expect(screen.getByTestId('history-comparison')).toBeInTheDocument()
    expect(screen.queryByTestId('history-differences')).not.toBeInTheDocument()
  })

  it('el selector de métrica reordena la comparación (descendente)', () => {
    renderPanel([
      snapshot({
        id: 'a',
        strategyId: 's@low',
        metrics: { ...BASE_METRICS, netProfit: 50, roi: 0.01 },
      }),
      snapshot({
        id: 'b',
        strategyId: 's@high',
        metrics: { ...BASE_METRICS, netProfit: 200, roi: 0.01 },
      }),
      snapshot({
        id: 'c',
        strategyId: 's@mid',
        metrics: { ...BASE_METRICS, netProfit: 100, roi: 0.2 },
      }),
    ])
    selectCheckbox(0)
    selectCheckbox(1)
    selectCheckbox(2)

    // por defecto netProfit: high (200) → mid (100) → low (50)
    let rows = comparisonRowTexts()
    expect(rows[0]).toContain('s@high')
    expect(rows[1]).toContain('s@mid')
    expect(rows[2]).toContain('s@low')

    fireEvent.change(screen.getByLabelText('Métrica de ranking'), { target: { value: 'roi' } })

    // con ROI: mid (0.2) → low y high empatan (0.01, orden de entrada: a antes que b)
    rows = comparisonRowTexts()
    expect(rows[0]).toContain('s@mid')
    expect(rows[1]).toContain('s@low')
    expect(rows[2]).toContain('s@high')
  })
})

describe('ExperimentHistoryPanel — acciones', () => {
  it('borrar selección envía los ids seleccionados', () => {
    const { onRemove } = renderPanel([snapshot({ id: 'a' }), snapshot({ id: 'b' })])
    selectCheckbox(0)
    selectCheckbox(1)

    fireEvent.click(screen.getByRole('button', { name: 'Borrar selección' }))

    expect(onRemove).toHaveBeenCalledWith(['a', 'b'])
  })

  it('borrar selección vacía está deshabilitado y borrar todo llama onClear', () => {
    const { onRemove, onClear } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Borrar selección' }))
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Borrar todo' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
