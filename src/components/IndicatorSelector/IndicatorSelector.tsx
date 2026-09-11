import { useEffect, useRef, useState } from 'react';
import { IndicatorId, IndicatorInstance } from '../../types/asset';
import { getDefinition, getIndicatorGroups } from '../../services/IndicatorService';

interface IndicatorSelectorProps {
  indicators: IndicatorInstance[];
  onAdd: (id: IndicatorId) => void;
  onRemove: (key: string) => void;
  disabled?: boolean;
}

export function IndicatorSelector({
  indicators,
  onAdd,
  onRemove,
  disabled,
}: IndicatorSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const groups = getIndicatorGroups();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const handleAdd = (id: IndicatorId) => {
    onAdd(id);
    setOpen(false);
  };

  return (
    <div className="indicator-selector" ref={containerRef}>
      <div className="indicator-add">
        <button
          className="indicator-add-btn"
          onClick={() => setOpen(value => !value)}
          disabled={disabled}
        >
          + Indicator
        </button>
        {open && (
          <div className="indicator-dropdown">
            <div className="indicator-group">
              <div className="indicator-group-title">Overlays</div>
              {groups.overlays.map(definition => (
                <button
                  key={definition.id}
                  className="indicator-option"
                  onClick={() => handleAdd(definition.id)}
                >
                  {definition.label}
                </button>
              ))}
            </div>
            <div className="indicator-group">
              <div className="indicator-group-title">Oscillators</div>
              {groups.oscillators.map(definition => (
                <button
                  key={definition.id}
                  className="indicator-option"
                  onClick={() => handleAdd(definition.id)}
                >
                  {definition.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="indicator-chips">
        {indicators.map(indicator => {
          const definition = getDefinition(indicator.indicatorId);
          return (
            <span key={indicator.key} className="indicator-chip">
              <span className="indicator-chip-label">
                {definition?.label ?? indicator.indicatorId}
              </span>
              <button
                className="indicator-chip-remove"
                onClick={() => onRemove(indicator.key)}
                aria-label="Remove indicator"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
