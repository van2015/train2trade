import type { ConditionIndicatorOption } from '../../strategy/ConditionIndicatorCatalog';
import type { ConditionIndicatorId } from '../../strategy/StrategyDraftPresenter';

interface ParamInputsProps {
  params: ConditionIndicatorOption['params'];
  values: Record<string, number>;
  labelPrefix: string;
  onChange: (key: string, value: number) => void;
}

export function ParamInputs({
  params,
  values,
  labelPrefix,
  onChange,
}: ParamInputsProps) {
  return (
    <div className="strategy-params">
      {params.map((param) => (
        <label key={param.key} className="strategy-param">
          <span>{param.label}</span>
          <input
            type="number"
            min={param.min}
            aria-label={`${labelPrefix} ${param.label}`}
            value={values[param.key] ?? param.default}
            onChange={(event) =>
              onChange(param.key, Number(event.target.value))
            }
          />
        </label>
      ))}
    </div>
  );
}

interface IndicatorSelectProps {
  label: string;
  value: ConditionIndicatorId | null;
  options: ConditionIndicatorOption[];
  onChange: (indicatorId: ConditionIndicatorId) => void;
  id?: string;
}

export function IndicatorSelect({
  label,
  value,
  options,
  onChange,
  id,
}: IndicatorSelectProps) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => {
        const next = event.target.value;
        if (!next) return;
        onChange(next as ConditionIndicatorId);
      }}
    >
      <option value="">Select indicator</option>
      {options.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.label}
        </option>
      ))}
    </select>
  );
}
