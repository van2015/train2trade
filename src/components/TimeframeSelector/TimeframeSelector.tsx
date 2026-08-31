import { Timeframe } from '../../types/asset';

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
  disabled?: boolean;
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
];

export function TimeframeSelector({ value, onChange, disabled }: TimeframeSelectorProps) {
  return (
    <div className="timeframe-selector">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          className={`timeframe-btn ${value === tf.value ? 'active' : ''}`}
          onClick={() => onChange(tf.value)}
          disabled={disabled}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
