import { useAppPresenter } from '../../hooks/useAppPresenter';

interface AssetListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function AssetList({ selectedId, onSelect, onDelete, disabled }: AssetListProps) {
  const { getAssetList } = useAppPresenter();
  const assets = getAssetList();
  if (assets.length === 0) {
    return <div className="asset-list-empty">No assets imported</div>;
  }

  return (
    <div className="asset-list">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className={`asset-item ${selectedId === asset.id ? 'selected' : ''}`}
        >
          <span className="asset-name" onClick={() => onSelect(asset.id)}>
            {asset.name}
          </span>
          <button
            className="delete-btn"
            onClick={() => onDelete(asset.id)}
            disabled={disabled}
            aria-label="Delete asset"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
