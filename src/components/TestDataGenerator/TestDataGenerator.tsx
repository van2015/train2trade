import { useState, useCallback } from 'react';
import { Timeframe, Timeframe as TimeframeType } from '../../timeframe/Timeframe';
import { generateCSV, validateParams, TestDataParams } from '../../services/TestDataService';

interface TestDataGeneratorProps {
  onImport: (name: string, file: File) => Promise<void>;
  disabled?: boolean;
}

export function TestDataGenerator({ onImport, disabled }: TestDataGeneratorProps) {
  const [assetName, setAssetName] = useState('');
  const [timeframe, setTimeframe] = useState<TimeframeType>('1m');
  const [startingPrice, setStartingPrice] = useState('100.00');
  const [volatility, setVolatility] = useState('2.0');
  const [volumeMin, setVolumeMin] = useState('1000');
  const [volumeMax, setVolumeMax] = useState('10000');
  const [sampleCount, setSampleCount] = useState('1000');
  const [errors, setErrors] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const timeframes = Timeframe.getValues();

  const handleSubmit = useCallback(async () => {
    const params: TestDataParams = {
      assetName: assetName.trim(),
      timeframe,
      startingPrice: parseFloat(startingPrice),
      volatility: parseFloat(volatility),
      volumeMin: parseFloat(volumeMin),
      volumeMax: parseFloat(volumeMax),
      sampleCount: parseInt(sampleCount, 10),
    };

    const validation = validateParams(params);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setErrors([]);
    setGenerating(true);

    try {
      const csv = generateCSV(params);
      const blob = new Blob([csv], { type: 'text/csv' });
      const file = new File([blob], `${assetName}.csv`, { type: 'text/csv' });
      await onImport(assetName, file);
      setAssetName('');
      setStartingPrice('100.00');
      setVolatility('2.0');
      setVolumeMin('1000');
      setVolumeMax('10000');
      setSampleCount('1000');
    } catch {
      // Error handled by parent
    } finally {
      setGenerating(false);
    }
  }, [assetName, timeframe, startingPrice, volatility, volumeMin, volumeMax, sampleCount, onImport]);

  return (
    <div className="test-data-generator">
      <div className="tdg-row">
        <label htmlFor="tdg-name">Name</label>
        <input
          id="tdg-name"
          type="text"
          placeholder="TEST_AAPL"
          value={assetName}
          onChange={(e) => setAssetName(e.target.value)}
          disabled={disabled || generating}
        />
      </div>

      <div className="tdg-row">
        <label htmlFor="tdg-timeframe">Timeframe</label>
        <select
          id="tdg-timeframe"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as TimeframeType)}
          disabled={disabled || generating}
        >
          {timeframes.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      <div className="tdg-row">
        <label htmlFor="tdg-price">Price</label>
        <input
          id="tdg-price"
          type="number"
          placeholder="100.00"
          value={startingPrice}
          onChange={(e) => setStartingPrice(e.target.value)}
          disabled={disabled || generating}
          step="0.01"
          min="0.01"
        />
      </div>

      <div className="tdg-row">
        <label htmlFor="tdg-vol">Vol %</label>
        <input
          id="tdg-vol"
          type="number"
          placeholder="2.0"
          value={volatility}
          onChange={(e) => setVolatility(e.target.value)}
          disabled={disabled || generating}
          step="0.1"
          min="0.1"
          max="10"
        />
      </div>

      <div className="tdg-row">
        <label htmlFor="tdg-samples">Samples</label>
        <input
          id="tdg-samples"
          type="number"
          placeholder="1000"
          value={sampleCount}
          onChange={(e) => setSampleCount(e.target.value)}
          disabled={disabled || generating}
        />
      </div>

      <div className="tdg-row tdg-vol-row">
        <label>Volume</label>
        <div className="tdg-volume">
          <input
            className="tdg-vol-min"
            type="number"
            placeholder="Min"
            value={volumeMin}
            onChange={(e) => setVolumeMin(e.target.value)}
            disabled={disabled || generating}
          />
          <input
            className="tdg-vol-max"
            type="number"
            placeholder="Max"
            value={volumeMax}
            onChange={(e) => setVolumeMax(e.target.value)}
            disabled={disabled || generating}
          />
        </div>
      </div>

      {errors.length > 0 && (
        <div className="validation-errors">
          {errors.map((error, i) => (
            <div key={i}>{error}</div>
          ))}
        </div>
      )}

      <button
        className="generate-btn"
        onClick={handleSubmit}
        disabled={disabled || generating}
      >
        {generating ? 'Generating...' : 'Generate & Import'}
      </button>
    </div>
  );
}
