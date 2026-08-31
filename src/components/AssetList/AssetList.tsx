import { Asset } from '../../types/asset';

interface AssetListProps {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

export function AssetList({ assets, selectedId, onSelect, onDelete, disabled }: AssetListProps) {
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
          <span className="asset-data-count">{asset.data.length} points</span>
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
