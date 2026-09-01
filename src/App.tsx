import { useEffect } from 'react';
import { useAppPresenter } from './hooks/useAppPresenter';
import { useToast } from './hooks/useToast';
import { FileImport } from './components/FileImport/FileImport';
import { AssetList } from './components/AssetList/AssetList';
import { ChartView } from './components/ChartView/ChartView';
import { Toast } from './components/Toast/Toast';

function App() {
  const {
    state,
    importAsset,
    selectAsset,
    removeAsset,
    clearWarnings,
  } = useAppPresenter();
  const { toasts, showToast, dismissToast } = useToast();

  useEffect(() => {
    if (state.warnings.length > 0) {
      state.warnings.forEach(warning => showToast(warning, 'warning'));
      clearWarnings();
    }
  }, [state.warnings, showToast, clearWarnings]);

  return (
    <div className="app">
      <Toast toasts={toasts} onDismiss={dismissToast} />
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
          <ChartView assetId={state.selectedAssetId} />
        </section>
      </main>
    </div>
  );
}

export default App;
