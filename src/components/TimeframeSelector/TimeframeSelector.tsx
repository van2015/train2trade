import { Timeframe, Timeframe as TimeframeType } from '../../shared/timeframe/Timeframe';

interface TimeframeSelectorProps {
  value: TimeframeType;
  onChange: (timeframe: TimeframeType) => void;
  disabled?: boolean;
}

export function TimeframeSelector({ value, onChange, disabled }: TimeframeSelectorProps) {
  const timeframes = Timeframe.getValues();

  return (
    <div className="timeframe-selector">
      {timeframes.map((tf) => (
        <button
          key={tf}
          className={`timeframe-btn ${value === tf ? 'active' : ''}`}
          onClick={() => onChange(tf)}
          disabled={disabled}
        >
          {Timeframe.getLabel(tf)}
        </button>
      ))}
    </div>
  );
}
