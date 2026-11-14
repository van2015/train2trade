import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BinanceProvider } from '@/api/binanceProvider'
import { CandleRepository } from '@/storage/candleRepository'
import { ExperimentRepository } from '@/storage/experimentRepository'
import { StrategyRepository } from '@/storage/strategyRepository'
import { App } from '@/components/App'
import '@/styles.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('No se encontró el elemento #root en index.html')
}

// La demo se siembra solo si no hay ninguna estrategia persistida (§1.7).
const strategies = new StrategyRepository(window.localStorage)
strategies.seedIfEmpty()

createRoot(container).render(
  <StrictMode>
    <App
      repository={new CandleRepository(window.localStorage)}
      provider={new BinanceProvider()}
      experiments={new ExperimentRepository(window.localStorage)}
      strategies={strategies}
    />
  </StrictMode>,
)
