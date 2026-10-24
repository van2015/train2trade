import { useReducer, useState } from 'react';
import {
  type ConditionIndicatorOption,
  getConditionIndicatorOptions,
} from '../../strategy/ConditionIndicatorCatalog';
import {
  CONDITION_FIELDS,
  type ComparisonOperator,
  type ConditionField,
  type ConditionIndicatorId,
  type ConditionRightSide,
  FIELD_LABELS,
  OPERATORS,
  StrategyDraftPresenter,
} from '../../strategy/StrategyDraftPresenter';

const ATTRIBUTE_LABELS: Record<string, string> = {
  indicator: 'indicator',
  operator: 'operator',
  value: 'value',
  rightIndicator: 'right indicator',
};

function formatMissing(path: string): string {
  if (path === 'name') return 'Name';
  const [field, attribute] = path.split('.');
  return `${FIELD_LABELS[field as ConditionField]} ${ATTRIBUTE_LABELS[attribute] ?? attribute}`;
}

interface ParamInputsProps {
  params: ConditionIndicatorOption['params'];
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
}

function ParamInputs({ params, values, onChange }: ParamInputsProps) {
  return (
    <div className="strategy-params">
      {params.map((param) => (
        <label key={param.key} className="strategy-param">
          <span>{param.label}</span>
          <input
            type="number"
            min={param.min}
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

export function StrategyBuilder() {
  const [presenter] = useState(() => new StrategyDraftPresenter());
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  const state = presenter.getState();
  const options = getConditionIndicatorOptions();

  const update = (action: () => void) => {
    action();
    rerender();
  };

  return (
    <div className="strategy-builder">
      <label className="strategy-field">
        <span>Name</span>
        <input
          type="text"
          value={state.name}
          onChange={(event) =>
            update(() => presenter.setName(event.target.value))
          }
          placeholder="Strategy name"
        />
      </label>

      {CONDITION_FIELDS.map((field) => {
        const label = FIELD_LABELS[field];
        const condition = state.conditions[field];
        const option = options.find(
          (candidate) => candidate.id === condition.indicatorId
        );
        const rightOption = options.find(
          (candidate) => candidate.id === condition.rightIndicatorId
        );

        return (
          <fieldset key={field} className="strategy-condition">
            <legend>{label}</legend>

            <select
              aria-label={`${label} indicator`}
              value={condition.indicatorId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                update(() =>
                  presenter.setConditionIndicator(
                    field,
                    value as ConditionIndicatorId
                  )
                );
              }}
            >
              <option value="">Select indicator</option>
              {options.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>

            {option && option.params.length > 0 && (
              <ParamInputs
                params={option.params}
                values={condition.params}
                onChange={(key, value) =>
                  update(() =>
                    presenter.updateConditionParams(field, { [key]: value })
                  )
                }
              />
            )}

            <div className="strategy-condition-row">
              <select
                aria-label={`${label} operator`}
                value={condition.operator ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  update(() =>
                    presenter.setConditionOperator(
                      field,
                      value as ComparisonOperator
                    )
                  );
                }}
              >
                <option value="">Operator</option>
                {OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </select>

              <select
                aria-label={`${label} right side`}
                value={condition.rightSide}
                onChange={(event) =>
                  update(() =>
                    presenter.setConditionRightSide(
                      field,
                      event.target.value as ConditionRightSide
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
                <select
                  aria-label={`${label} right indicator`}
                  value={condition.rightIndicatorId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) return;
                    update(() =>
                      presenter.setConditionRightIndicator(
                        field,
                        value as ConditionIndicatorId
                      )
                    );
                  }}
                >
                  <option value="">Select indicator</option>
                  {options.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>

                {rightOption && rightOption.params.length > 0 && (
                  <ParamInputs
                    params={rightOption.params}
                    values={condition.rightParams}
                    onChange={(key, value) =>
                      update(() =>
                        presenter.updateConditionRightParams(field, {
                          [key]: value,
                        })
                      )
                    }
                  />
                )}
              </>
            ) : (
              <input
                aria-label={`${label} value`}
                type="number"
                value={condition.value ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  update(() =>
                    presenter.setConditionValue(
                      field,
                      value === '' ? null : Number(value)
                    )
                  );
                }}
                placeholder="Value"
              />
            )}
          </fieldset>
        );
      })}

      {state.isReady && state.summary ? (
        <div className="strategy-summary">
          <h3>Summary</h3>
          <p>
            <strong>Name:</strong> {state.name}
          </p>
          {CONDITION_FIELDS.map((field) => (
            <p key={field}>
              <strong>{FIELD_LABELS[field]}:</strong> {state.summary?.[field]}
            </p>
          ))}
          <p className="strategy-ready">Ready to save</p>
        </div>
      ) : (
        <div className="strategy-missing">
          <p>Missing:</p>
          <ul>
            {state.missing.map((item) => (
              <li key={item}>{formatMissing(item)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
