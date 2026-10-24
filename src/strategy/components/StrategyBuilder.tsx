import { useReducer, useState } from 'react';
import { getConditionIndicatorOptions } from '../ConditionIndicatorCatalog';
import {
  type ComparisonOperator,
  type ConditionField,
  type ConditionIndicatorId,
  StrategyDraftPresenter,
} from '../StrategyDraftPresenter';

const CONDITION_FIELDS: { field: ConditionField; label: string }[] = [
  { field: 'entry', label: 'Entry' },
  { field: 'stopLoss', label: 'Stop Loss' },
  { field: 'takeProfit', label: 'Take Profit' },
];

const OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
];

const FIELD_LABELS: Record<ConditionField, string> = {
  entry: 'Entry',
  stopLoss: 'Stop Loss',
  takeProfit: 'Take Profit',
};

function formatMissing(path: string): string {
  if (path === 'name') return 'Name';
  const [field, attribute] = path.split('.');
  return `${FIELD_LABELS[field as ConditionField]} ${attribute}`;
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

      {CONDITION_FIELDS.map(({ field, label }) => {
        const condition = state.conditions[field];
        const option = options.find(
          (candidate) => candidate.id === condition.indicatorId
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
              <div className="strategy-params">
                {option.params.map((param) => (
                  <label key={param.key} className="strategy-param">
                    <span>{param.label}</span>
                    <input
                      type="number"
                      min={param.min}
                      value={condition.params[param.key] ?? param.default}
                      onChange={(event) =>
                        update(() =>
                          presenter.updateConditionParams(field, {
                            [param.key]: Number(event.target.value),
                          })
                        )
                      }
                    />
                  </label>
                ))}
              </div>
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
            </div>
          </fieldset>
        );
      })}

      {state.isReady && state.summary ? (
        <div className="strategy-summary">
          <h3>Summary</h3>
          <p>
            <strong>Name:</strong> {state.name}
          </p>
          {CONDITION_FIELDS.map(({ field, label }) => (
            <p key={field}>
              <strong>{label}:</strong> {state.summary?.[field]}
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
