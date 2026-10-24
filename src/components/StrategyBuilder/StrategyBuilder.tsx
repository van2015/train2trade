import { useReducer, useState } from 'react';
import { getConditionIndicatorOptions } from '../../strategy/ConditionIndicatorCatalog';
import {
  type ConditionConnector,
  type ConditionField,
  StrategyDraftPresenter,
} from '../../strategy/StrategyDraftPresenter';
import { ConditionEditor } from './ConditionEditor';

const ATTRIBUTE_LABELS: Record<string, string> = {
  indicator: 'indicator',
  operator: 'operator',
  value: 'value',
  rightIndicator: 'right indicator',
};

function formatMissing(path: string): string {
  if (path === 'name') return 'Name';

  const [field, indexOrAttribute, attribute] = path.split('.');
  const label = StrategyDraftPresenter.FIELD_LABELS[field as ConditionField];

  if (indexOrAttribute === 'conditions') return `${label}: no conditions`;
  if (attribute !== undefined) {
    return `${label} condition ${indexOrAttribute} ${ATTRIBUTE_LABELS[attribute] ?? attribute}`;
  }

  return `${label} ${ATTRIBUTE_LABELS[indexOrAttribute] ?? indexOrAttribute}`;
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

      {StrategyDraftPresenter.CONDITION_FIELDS.map((field) => {
        const label = StrategyDraftPresenter.FIELD_LABELS[field];
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

            {group.conditions.map((condition, index) => (
              <ConditionEditor
                key={condition.draftId}
                field={field}
                condition={condition}
                index={index}
                conditionLabel={`${label} condition ${index + 1}`}
                options={options}
                update={update}
                presenter={presenter}
              />
            ))}

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
          {StrategyDraftPresenter.CONDITION_FIELDS.map((field) => (
            <p key={field}>
              <strong>{StrategyDraftPresenter.FIELD_LABELS[field]}:</strong>{' '}
              {state.summary?.[field]}
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
