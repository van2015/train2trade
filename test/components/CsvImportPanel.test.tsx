import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CsvImportPanel, type CsvImportPanelProps } from '@/components/CsvImportPanel'
import type { Candle } from '@/domain/candles/candle'

const CSV_WITH_HEADER = [
  'time,open,high,low,close,volume',
  '1700000000000,100,110,90,105,42',
  '1700003600000,105,115,100,110,55',
].join('\n')

const CSV_NO_HEADER = '1700000000000,100,110,90,105,42'

function renderPanel(overrides: Partial<CsvImportPanelProps> = {}) {
  const onImport = vi.fn<(candles: readonly Candle[]) => void>()
  const onError = vi.fn<(message: string) => void>()
  render(
    <CsvImportPanel target="BTC/USDT · 1h" onImport={onImport} onError={onError} {...overrides} />,
  )
  return { onImport, onError }
}

function selectFile(name: string, content: string) {
  const input = screen.getByLabelText('Fichero')
  const file = new File([content], name, { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('CsvImportPanel', () => {
  it('muestra el destino de la importación', () => {
    renderPanel()

    expect(screen.getByText('BTC/USDT · 1h')).toBeInTheDocument()
    expect(screen.getByText(/time, open, high, low, close, volume/)).toBeInTheDocument()
  })

  it('el botón de importar está deshabilitado hasta elegir un fichero', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
  })

  it('muestra el nombre del fichero elegido y habilita el botón', () => {
    renderPanel()

    selectFile('velas.csv', CSV_WITH_HEADER)

    expect(screen.getByText('velas.csv')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeEnabled()
  })

  it('parsea el CSV y entrega las velas al confirmar', async () => {
    const { onImport, onError } = renderPanel()

    selectFile('velas.csv', CSV_WITH_HEADER)
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onError).not.toHaveBeenCalled()

    const candles = onImport.mock.calls[0]?.[0] ?? []
    expect(candles).toHaveLength(2)
    expect(candles[0]?.time).toBe(1_700_000_000_000)
    expect(candles[0]?.close).toBe(105)
    expect(candles[1]?.close).toBe(110)
  })

  it('aplica el formato de tiempo seleccionado (unix en segundos)', async () => {
    const { onImport } = renderPanel()

    selectFile('velas.csv', 'time,open,high,low,close,volume\n1700000000,100,110,90,105,42')
    fireEvent.change(screen.getByLabelText('Formato de tiempo'), {
      target: { value: 'unixSeconds' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0]?.[0][0]?.time).toBe(1_700_000_000_000)
  })

  it('interpreta la primera fila como datos cuando se desmarca la cabecera', async () => {
    const { onImport } = renderPanel()

    selectFile('velas.csv', CSV_NO_HEADER)
    fireEvent.click(screen.getByLabelText('La primera fila es cabecera'))
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(onImport.mock.calls[0]?.[0]).toHaveLength(1)
  })

  it('con cabecera marcada, la primera fila no se convierte en vela', async () => {
    const { onImport, onError } = renderPanel()

    selectFile('velas.csv', CSV_NO_HEADER)
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no contiene velas válidas'))
    expect(onImport).not.toHaveBeenCalled()
  })

  it('informa del error de parseo sin entregar velas', async () => {
    const { onImport, onError } = renderPanel()

    // Cabecera con una columna inexistente → `InvalidCsvError` al resolver el layout.
    selectFile('velas.csv', 'timestamp,close\n1700000000000,105')
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onImport).not.toHaveBeenCalled()
  })

  it('limpia el fichero tras una importación exitosa', async () => {
    const { onImport } = renderPanel()

    selectFile('velas.csv', CSV_WITH_HEADER)
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('velas.csv')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
  })

  it('no permite importar dos veces seguidas mientras está ocupado', async () => {
    const { onImport } = renderPanel()

    selectFile('velas.csv', CSV_WITH_HEADER)
    const button = screen.getByRole('button', { name: 'Importar' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  })

  it('deshabilita los controles cuando el padre lo indica', () => {
    renderPanel({ disabled: true })

    expect(screen.getByLabelText('Fichero')).toBeDisabled()
    expect(screen.getByLabelText('Formato de tiempo')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
  })
})
