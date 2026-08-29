import React, { useCallback } from 'react';

interface FileImportProps {
  onImport: (name: string, file: File) => Promise<void>;
  disabled?: boolean;
}

export function FileImport({ onImport, disabled }: FileImportProps) {
  const [assetName, setAssetName] = React.useState('');
  const [importing, setImporting] = React.useState(false);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        await onImport(assetName || file.name.replace(/\.[^.]+$/, ''), file);
        setAssetName('');
        e.target.value = '';
      } catch {
        // Error handled by parent
      } finally {
        setImporting(false);
      }
    },
    [assetName, onImport]
  );

  return (
    <div className="file-import">
      <input
        type="text"
        placeholder="Asset name (optional)"
        value={assetName}
        onChange={(e) => setAssetName(e.target.value)}
        disabled={disabled || importing}
      />
      <label className="file-input-label">
        <input
          type="file"
          accept=".csv,.json"
          onChange={handleFileChange}
          disabled={disabled || importing}
        />
        <span>{importing ? 'Importing...' : 'Select File'}</span>
      </label>
    </div>
  );
}
