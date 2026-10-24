import { useEffect } from 'react';
import { useAppPresenter } from './app/hooks/useAppPresenter';
import { useToast } from './app/hooks/useToast';
import { ChartView } from './chart/components/ChartView';
import { AssetList } from './components/AssetList/AssetList';
import { FileImport } from './components/FileImport/FileImport';
import { TestDataGenerator } from './components/TestDataGenerator/TestDataGenerator';
import { initTheme, ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { Toast } from './components/Toast/Toast';
import { StrategyBuilder } from './strategy/components/StrategyBuilder';

initTheme();

function App() {
  const { state, importAsset, selectAsset, removeAsset, clearWarnings } =
    useAppPresenter();
  const { toasts, showToast, dismissToast } = useToast();

  useEffect(() => {
    if (state.warnings.length > 0) {
      state.warnings.forEach((warning) => {
        showToast(warning, 'warning');
      });
      clearWarnings();
    }
  }, [state.warnings, showToast, clearWarnings]);

  return (
    <div className="app">
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <header className="app-header">
        <h1>Asset Chart Analysis</h1>
        <ThemeToggle />
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <section className="import-section">
            <h2>Import</h2>
            <FileImport onImport={importAsset} />
          </section>

          <section className="test-data-section">
            <h2>Test Data</h2>
            <TestDataGenerator onImport={importAsset} />
          </section>

          <section className="assets-section">
            <h2>Assets</h2>
            <AssetList
              selectedId={state.selectedAssetId}
              onSelect={selectAsset}
              onDelete={removeAsset}
            />
          </section>

          <section className="strategy-section">
            <h2>Strategies</h2>
            <StrategyBuilder />
          </section>
        </aside>

        <section className="chart-section">
          {state.error && (
            <div className="error-message">{state.error.message}</div>
          )}
          <ChartView assetId={state.selectedAssetId} />
        </section>
      </main>
    </div>
  );
}

export default App;
