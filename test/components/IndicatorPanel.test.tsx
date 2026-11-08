import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IndicatorPanel } from '@/components/IndicatorPanel'
import { DEFAULT_INDICATOR_SETTINGS, type IndicatorSettings } from '@/components/chartData'

function renderPanel(settings: IndicatorSettings = DEFAULT_INDICATOR_SETTINGS) {
  const onChange = vi.fn()
  render(<IndicatorPanel settings={settings} onChange={onChange} />)
  return { onChange }
}

describe('IndicatorPanel', () => {
  it('muestra los tres indicadores con sus periodos por defecto', () => {
    renderPanel()

    expect(screen.getByRole('checkbox', { name: /SMA/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /EMA/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /RSI/ })).not.toBeChecked()

    expect(screen.getByLabelText('Periodo de SMA')).toHaveValue(20)
    expect(screen.getByLabelText('Periodo de EMA')).toHaveValue(20)
    expect(screen.getByLabelText('Periodo de RSI')).toHaveValue(14)
  })

  it('notifica al activar un indicador', () => {
    const { onChange } = renderPanel()

    fireEvent.click(screen.getByRole('checkbox', { name: /RSI/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_INDICATOR_SETTINGS,
      rsi: { enabled: true, period: 14 },
    })
  })

  it('notifica al desactivar un indicador', () => {
    const { onChange } = renderPanel()

    fireEvent.click(screen.getByRole('checkbox', { name: /SMA/ }))

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_INDICATOR_SETTINGS,
      sma: { enabled: false, period: 20 },
    })
  })

  it('notifica al cambiar el periodo conservando el resto de la configuración', () => {
    const { onChange } = renderPanel()

    fireEvent.change(screen.getByLabelText('Periodo de EMA'), { target: { value: '55' } })

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_INDICATOR_SETTINGS,
      ema: { enabled: false, period: 55 },
    })
  })

  it('ignora periodos que no sean enteros >= 1', () => {
    const { onChange } = renderPanel()

    fireEvent.change(screen.getByLabelText('Periodo de SMA'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Periodo de SMA'), { target: { value: '-3' } })
    fireEvent.change(screen.getByLabelText('Periodo de SMA'), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText('Periodo de SMA'), { target: { value: '' } })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('deshabilita el campo de periodo cuando el indicador está apagado', () => {
    renderPanel()

    expect(screen.getByLabelText('Periodo de SMA')).not.toBeDisabled()
    expect(screen.getByLabelText('Periodo de EMA')).toBeDisabled()
    expect(screen.getByLabelText('Periodo de RSI')).toBeDisabled()
  })

  it('refleja los cambios de configuración recibidos por props', () => {
    const settings: IndicatorSettings = {
      sma: { enabled: true, period: 7 },
      ema: { enabled: true, period: 21 },
      rsi: { enabled: true, period: 9 },
    }
    renderPanel(settings)

    expect(screen.getByLabelText('Periodo de SMA')).toHaveValue(7)
    expect(screen.getByLabelText('Periodo de EMA')).toHaveValue(21)
    expect(screen.getByLabelText('Periodo de RSI')).toHaveValue(9)
    expect(screen.getByRole('checkbox', { name: /EMA/ })).toBeChecked()
  })
})
