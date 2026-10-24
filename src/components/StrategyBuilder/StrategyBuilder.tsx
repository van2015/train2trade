import { useReducer, useState } from 'react';
import {
  type ConditionIndicatorOption,
  getConditionIndicatorOptions,
} from '../../strategy/ConditionIndicatorCatalog';
import {
  CONDITION_FIELDS,
  type ComparisonOperator,
  type ConditionConnector,
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

  const [field, indexOrAttribute, attribute] = path.split('.');
  const label = FIELD_LABELS[field as ConditionField];

  if (indexOrAttribute === 'conditions') return `${label}: no conditions`;
  if (attribute !== undefined) {
    return `${label} condition ${indexOrAttribute} ${ATTRIBUTE_LABELS[attribute] ?? attribute}`;
  }

  return `${label} ${ATTRIBUTE_LABELS[indexOrAttribute] ?? indexOrAttribute}`;
}

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
        const group = state.conditions[field];

        return (
          <fieldset key={field} className="strategy-condition">
            <legend>{label}</legend>

            {group.conditions.length > 1 && (
              <label className="strategy-field">
                <span>Join with</span>
                <select
                  aria-label={`${label} join with`}
                  value={group.connector}
                  onChange={(event) =>
                    update(() =>
                      presenter.setConditionConnector(
                        field,
                        event.target.value as ConditionConnector
                      )
                    )
                  }
                >
                  <option value="and">AND</option>
                  <option value="or">OR</option>
                </select>
              </label>
            )}

            {group.conditions.map((condition, index) => {
              const option = options.find(
                (candidate) => candidate.id === condition.indicatorId
              );
              const rightOption = options.find(
                (candidate) => candidate.id === condition.rightIndicatorId
              );
              const conditionLabel = `${label} condition ${index + 1}`;

              return (
                <fieldset
                  key={condition.id}
                  className="strategy-condition-item"
                >
                  <legend>{conditionLabel}</legend>

                  <select
                    aria-label={`${conditionLabel} indicator`}
                    value={condition.indicatorId ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return;
                      update(() =>
                        presenter.setConditionIndicator(
                          field,
                          value as ConditionIndicatorId,
                          index
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
                      labelPrefix={conditionLabel}
                      onChange={(key, value) =>
                        update(() =>
                          presenter.updateConditionParams(
                            field,
                            { [key]: value },
                            index
                          )
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
                      {OPERATORS.map((operator) => (
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
                      <select
                        aria-label={`${conditionLabel} right indicator`}
                        value={condition.rightIndicatorId ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!value) return;
                          update(() =>
                            presenter.setConditionRightIndicator(
                              field,
                              value as ConditionIndicatorId,
                              index
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
                      onClick={() =>
                        update(() => presenter.removeCondition(field, index))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              );
            })}

            <button
              type="button"
              className="strategy-add"
              aria-label={`${label} add condition`}
              onClick={() => update(() => presenter.addCondition(field))}
            >
              + Add condition
            </button>
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
