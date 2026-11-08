import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BinanceProvider } from '@/api/binanceProvider'
import { CandleRepository } from '@/storage/candleRepository'
import { App } from '@/components/App'
import '@/styles.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('No se encontró el elemento #root en index.html')
}

createRoot(container).render(
  <StrictMode>
    <App repository={new CandleRepository(window.localStorage)} provider={new BinanceProvider()} />
  </StrictMode>,
)
