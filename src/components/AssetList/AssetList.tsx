import { AssetSummary } from '../../types/asset';

interface AssetListProps {
  assets: AssetSummary[];
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
