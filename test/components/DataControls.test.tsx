import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataControls, buildRange, type DataControlsProps } from '@/components/DataControls'
import { Timeframe } from '@/domain/candles/timeframe'
import { Instrument } from '@/domain/instruments/instrument'

const BTC_USDT = Instrument.of('BTC', 'USDT')

function renderControls(overrides: Partial<DataControlsProps> = {}) {
  const onInstrumentChange = vi.fn()
  const onTimeframeChange = vi.fn()
  const onFetch = vi.fn()
  render(
    <DataControls
      instruments={[]}
      instrument={BTC_USDT}
      timeframe={Timeframe.HOUR}
      busy={false}
      onInstrumentChange={onInstrumentChange}
      onTimeframeChange={onTimeframeChange}
      onFetch={onFetch}
      {...overrides}
    />,
  )
  return { onInstrumentChange, onTimeframeChange, onFetch }
}

describe('buildRange', () => {
  it('devuelve undefined cuando ambos campos están vacíos', () => {
    expect(buildRange('', '')).toBeUndefined()
  })

  it('interpreta from como inicio del día UTC y to como final del día', () => {
    expect(buildRange('2024-01-01', '')).toEqual({ from: 1_704_067_200_000, to: undefined })
    expect(buildRange('', '2024-01-01')).toEqual({
      from: undefined,
      to: 1_704_153_599_999,
    })
  })

  it('convierte un rango completo', () => {
    const range = buildRange('2024-01-01', '2024-01-31')
    expect(range?.from).toBe(1_704_067_200_000)
    expect(range?.to).toBe(1_706_745_599_999)
  })

  it('lanza RangeError si el rango está invertido', () => {
    expect(() => buildRange('2024-02-01', '2024-01-01')).toThrow(RangeError)
    expect(() => buildRange('2024-02-01', '2024-01-01')).toThrow(/posterior/)
  })

  it('acepta el mismo día en ambos extremos', () => {
    const range = buildRange('2024-01-01', '2024-01-01')
    expect(range?.from).toBeLessThan(range?.to ?? 0)
  })

  it('lanza RangeError con fechas malformadas', () => {
    expect(() => buildRange('no-es-fecha', '')).toThrow(RangeError)
    expect(() => buildRange('', 'tampoco')).toThrow(RangeError)
  })
})

describe('DataControls', () => {
  it('muestra el instrumento y el timeframe actuales', () => {
    renderControls()

    expect(screen.getByLabelText('Instrumento')).toHaveValue('BTC/USDT')
    expect(screen.getByLabelText('Timeframe')).toHaveValue('1h')
  })

  it('lista todos los timeframes soportados', () => {
    renderControls()

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['1m', '5m', '15m', '1h', '4h', '1d'])
  })

  it('notifica al cambiar el timeframe', () => {
    const { onTimeframeChange } = renderControls()

    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: '4h' } })

    expect(onTimeframeChange).toHaveBeenCalledWith(Timeframe.FOUR_HOURS)
  })

  it('notifica al escribir un instrumento válido', () => {
    const { onInstrumentChange } = renderControls()

    fireEvent.change(screen.getByLabelText('Instrumento'), { target: { value: 'ETH/USDT' } })

    expect(onInstrumentChange).toHaveBeenCalledWith(Instrument.of('ETH', 'USDT'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no notifica un instrumento inválido mientras se escribe', () => {
    const { onInstrumentChange } = renderControls()

    fireEvent.change(screen.getByLabelText('Instrumento'), { target: { value: 'ETH' } })

    expect(onInstrumentChange).not.toHaveBeenCalled()
  })

  it('muestra un error y revierte el valor al salir con un instrumento inválido', () => {
    const { onInstrumentChange } = renderControls()
    const input = screen.getByLabelText('Instrumento')

    fireEvent.change(input, { target: { value: 'cualquier cosa' } })
    fireEvent.blur(input)

    expect(onInstrumentChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/BASE\/QUOTE/)
    expect(input).toHaveValue('BTC/USDT')
  })

  it('saca el error al salir con el valor válido actual', () => {
    renderControls()
    const input = screen.getByLabelText('Instrumento')

    fireEvent.change(input, { target: { value: 'ETH' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'SOL/USDT' } })
    fireEvent.blur(input)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('muestra las sugerencias de instrumentos en el desplegable', () => {
    renderControls({ instruments: [Instrument.of('DOGE', 'USDT')] })

    const values = [...document.querySelectorAll('#data-controls__instruments option')].map(
      (option) => option.getAttribute('value'),
    )
    expect(values).toContain('BTC/USDT')
    expect(values).toContain('DOGE/USDT')
    expect(values).toContain('ETH/USDT')
  })

  it('descarga sin rango cuando las fechas están vacías', () => {
    const { onFetch } = renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    expect(onFetch).toHaveBeenCalledWith(undefined)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('descarga con el rango indicado', () => {
    const { onFetch } = renderControls()

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2024-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2024-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    expect(onFetch).toHaveBeenCalledWith({ from: 1_704_067_200_000, to: 1_706_745_599_999 })
  })

  it('no descarga y muestra error si el rango está invertido', () => {
    const { onFetch } = renderControls()

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2024-02-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2024-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar velas' }))

    expect(onFetch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/posterior/)
  })

  it('deshabilita el botón mientras hay una descarga en curso', () => {
    renderControls({ busy: true })

    expect(screen.getByRole('button', { name: 'Descargando…' })).toBeDisabled()
  })
})
