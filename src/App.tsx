import { useAppPresenter } from './hooks/useAppPresenter';
import { FileImport } from './components/FileImport/FileImport';
import { AssetList } from './components/AssetList/AssetList';
import { ChartView } from './components/ChartView/ChartView';

function App() {
  const { state, importAsset, selectAsset, removeAsset, changeChartType } = useAppPresenter();

  const selectedAsset = state.assets.find(a => a.id === state.selectedAssetId) || null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Asset Chart Analysis</h1>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <section className="import-section">
            <h2>Import</h2>
            <FileImport onImport={importAsset} />
          </section>

          <section className="assets-section">
            <h2>Assets</h2>
            <AssetList
              assets={state.assets}
              selectedId={state.selectedAssetId}
              onSelect={selectAsset}
              onDelete={removeAsset}
            />
          </section>
        </aside>

        <section className="chart-section">
          {state.error && <div className="error-message">{state.error}</div>}
          <ChartView
            data={selectedAsset?.data || null}
            chartType={state.chartType}
            onChartTypeChange={changeChartType}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
