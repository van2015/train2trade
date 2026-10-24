import type { ConditionIndicatorOption } from '../../strategy/ConditionIndicatorCatalog';
import {
  type ComparisonOperator,
  type ConditionField,
  type ConditionIndicatorId,
  type ConditionRightSide,
  type StrategyCondition,
  StrategyDraftPresenter,
} from '../../strategy/StrategyDraftPresenter';

interface ParamInputsProps {
  params: ConditionIndicatorOption['params'];
  values: Record<string, number>;
  labelPrefix: string;
  onChange: (key: string, value: number) => void;
}

function ParamInputs({
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
}

function IndicatorSelect({
  label,
  value,
  options,
  onChange,
}: IndicatorSelectProps) {
  return (
    <select
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

interface ConditionEditorProps {
  field: ConditionField;
  condition: StrategyCondition;
  index: number;
  conditionLabel: string;
  options: ConditionIndicatorOption[];
  update: (action: () => void) => void;
  presenter: StrategyDraftPresenter;
}

export function ConditionEditor({
  field,
  condition,
  index,
  conditionLabel,
  options,
  update,
  presenter,
}: ConditionEditorProps) {
  const option = options.find(
    (candidate) => candidate.id === condition.indicatorId
  );
  const rightOption = options.find(
    (candidate) => candidate.id === condition.rightIndicatorId
  );

  return (
    <fieldset className="strategy-condition-item">
      <legend>{conditionLabel}</legend>

      <IndicatorSelect
        label={`${conditionLabel} indicator`}
        value={condition.indicatorId}
        options={options}
        onChange={(indicatorId) =>
          update(() =>
            presenter.setConditionIndicator(field, indicatorId, index)
          )
        }
      />

      {option && option.params.length > 0 && (
        <ParamInputs
          params={option.params}
          values={condition.params}
          labelPrefix={conditionLabel}
          onChange={(key, value) =>
            update(() =>
              presenter.updateConditionParams(field, { [key]: value }, index)
            )
          }
        />
      )}

      <div className="strategy-condition-row">
        <select
          aria-label={`${conditionLabel} operator`}
          value={condition.operator ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            update(() =>
              presenter.setConditionOperator(
                field,
                value as ComparisonOperator,
                index
              )
            );
          }}
        >
          <option value="">Operator</option>
          {StrategyDraftPresenter.OPERATORS.map((operator) => (
            <option key={operator.value} value={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>

        <select
          aria-label={`${conditionLabel} right side`}
          value={condition.rightSide}
          onChange={(event) =>
            update(() =>
              presenter.setConditionRightSide(
                field,
                event.target.value as ConditionRightSide,
                index
              )
            )
          }
        >
          <option value="value">Value</option>
          <option value="indicator">Indicator</option>
        </select>
      </div>

      {condition.rightSide === 'indicator' ? (
        <>
          <IndicatorSelect
            label={`${conditionLabel} right indicator`}
            value={condition.rightIndicatorId}
            options={options}
            onChange={(indicatorId) =>
              update(() =>
                presenter.setConditionRightIndicator(field, indicatorId, index)
              )
            }
          />

          {rightOption && rightOption.params.length > 0 && (
            <ParamInputs
              params={rightOption.params}
              values={condition.rightParams}
              labelPrefix={`${conditionLabel} right`}
              onChange={(key, value) =>
                update(() =>
                  presenter.updateConditionRightParams(
                    field,
                    { [key]: value },
                    index
                  )
                )
              }
            />
          )}
        </>
      ) : (
        <input
          aria-label={`${conditionLabel} value`}
          type="number"
          value={condition.value ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            update(() =>
              presenter.setConditionValue(
                field,
                value === '' ? null : Number(value),
                index
              )
            );
          }}
          placeholder="Value"
        />
      )}

      <div className="strategy-condition-actions">
        <label className="strategy-negated">
          <input
            type="checkbox"
            aria-label={`${conditionLabel} NOT`}
            checked={condition.negated}
            onChange={(event) =>
              update(() =>
                presenter.setConditionNegated(
                  field,
                  event.target.checked,
                  index
                )
              )
            }
          />
          <span>NOT</span>
        </label>

        <button
          type="button"
          className="strategy-remove"
          aria-label={`${conditionLabel} remove`}
          onClick={() => update(() => presenter.removeCondition(field, index))}
        >
          Remove
        </button>
      </div>
    </fieldset>
  );
}
