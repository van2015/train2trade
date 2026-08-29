import { ChartType } from '../../types/asset';

interface ChartTypeSelectorProps {
  value: ChartType;
  onChange: (type: ChartType) => void;
  disabled?: boolean;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'candlestick', label: 'Candlestick' },
  { value: 'ohlc', label: 'OHLC' },
];

export function ChartTypeSelector({ value, onChange, disabled }: ChartTypeSelectorProps) {
  return (
    <div className="chart-type-selector">
      {CHART_TYPES.map((type) => (
        <button
          key={type.value}
          className={`chart-type-btn ${value === type.value ? 'active' : ''}`}
          onClick={() => onChange(type.value)}
          disabled={disabled}
        >
          {type.label}
        </button>
      ))}
    </div>
  );
}
