import { useState, useCallback } from 'react';
import { Asset, ChartType } from './types/asset';
import { useAssets } from './hooks/useAssets';
import { FileImport } from './components/FileImport/FileImport';
import { AssetList } from './components/AssetList/AssetList';
import { ChartView } from './components/ChartView/ChartView';

function App() {
  const { assets, loading, error, addAsset, removeAsset } = useAssets();
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [chartType, setChartType] = useState<ChartType>('line');

  const handleImport = useCallback(
    async (name: string, file: File) => {
      const asset = await addAsset(name, file);
      setSelectedAsset(asset);
    },
    [addAsset]
  );

  const handleSelect = useCallback((asset: Asset) => {
    setSelectedAsset(asset);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await removeAsset(id);
      if (selectedAsset?.id === id) {
        setSelectedAsset(null);
      }
    },
    [removeAsset, selectedAsset]
  );

  const handleChartTypeChange = useCallback((type: ChartType) => {
    setChartType(type);
  }, []);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Asset Chart Analysis</h1>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <section className="import-section">
            <h2>Import</h2>
            <FileImport onImport={handleImport} />
          </section>

          <section className="assets-section">
            <h2>Assets</h2>
            <AssetList
              assets={assets}
              selectedId={selectedAsset?.id || null}
              onSelect={handleSelect}
              onDelete={handleDelete}
            />
          </section>
        </aside>

        <section className="chart-section">
          {error && <div className="error-message">{error}</div>}
          <ChartView
            data={selectedAsset?.data || null}
            chartType={chartType}
            onChartTypeChange={handleChartTypeChange}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
