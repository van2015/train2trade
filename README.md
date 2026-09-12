# Asset Chart Analysis

A browser-based app to import, store, and analyze historical price data for financial assets. It renders interactive charts with multiple visualization types, timeframe aggregation, and technical indicators. Everything runs locally in your browser.

## Features

- **Import historical data** from CSV or JSON files.
- **Local persistence**: imported assets are stored in IndexedDB and remain available after reloading.
- **Chart types**: Line, Candlestick, and OHLC (bars).
- **Timeframes**: `1m`, `5m`, `15m`, `1h`, `4h`, `1D`, `1W`. Higher timeframes are aggregated from the original data.
- **Technical indicators**: SMA, EMA, Bollinger Bands, RSI, MACD, and Volume, shown as overlays or in separate panes.
- **On-demand history**: pan the chart to load older data as needed.
- **Test data generator**: create synthetic assets without importing a file.
- **Light and dark theme** toggle.

## Getting started

Requirements:

- [Node.js](https://nodejs.org/) 18 or newer
- A package manager: `pnpm` (recommended) or `npm`

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Then open the local URL shown in the terminal (by default `http://localhost:5173`).

With npm, replace `pnpm` with `npm run` (for example, `npm install` and `npm run dev`).

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server with hot reload. |
| `pnpm build` | Type-check and build the app for production into `dist/`. |
| `pnpm preview` | Serve the production build locally. |
| `pnpm test` | Run the test suite with Vitest. |
| `pnpm test:watch` | Run tests in watch mode. |
| `pnpm test:coverage` | Run tests and generate a coverage report. |

## Importing data

The importer accepts `.csv` and `.json` files. Each record must contain `date`, `open`, `high`, `low`, `close`, and `volume`.

CSV example:

```csv
date,open,high,low,close,volume
2024-01-02T00:00:00Z,100.00,102.50,99.10,101.80,12000
2024-01-03T00:00:00Z,101.80,103.20,100.40,102.90,9800
```

JSON example:

```json
[
  {
    "date": "2024-01-02T00:00:00Z",
    "open": 100.0,
    "high": 102.5,
    "low": 99.1,
    "close": 101.8,
    "volume": 12000
  }
]
```

Data is validated on import:

- Timestamps must be unique and ordered from oldest to newest.
- Prices must be non-negative and `high` must be greater than or equal to `low`.
- Values must be valid numbers (`open`, `high`, `low`, `close`, and `volume`).

The app automatically detects the original timeframe of the data. If gaps are detected or the timeframe cannot be determined with confidence, a warning is shown and the chart may display incomplete candles.

## Using the app

1. **Import or generate data**
   - Use **Import** to select a CSV/JSON file and optionally give the asset a name.
   - Or use **Test Data** to generate a synthetic asset by filling in a name, timeframe, starting price, volatility, sample count, and a volume range, then click **Generate & Import**.
2. **Select an asset** from the **Assets** list in the sidebar to load it into the chart.
3. **Customize the view** using the controls above the chart:
   - **Timeframe**: switch between `1m`, `5m`, `15m`, `1h`, `4h`, `1D`, and `1W`.
   - **Chart type**: Line, Candlestick, or OHLC.
   - **+ Indicator**: add SMA, EMA, Bollinger Bands, RSI, MACD, or Volume. Remove an indicator with the `×` on its chip.
4. **Explore history**: pan the chart to the left to load older data on demand.
5. **Delete an asset** with the `×` button next to its name in the **Assets** list.

## Data and privacy

All imported data is stored locally in your browser's IndexedDB. There is no backend, and no data is uploaded or shared.
