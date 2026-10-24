import { useReducer, useState } from 'react';
import { getConditionIndicatorOptions } from '../../strategy/ConditionIndicatorCatalog';
import {
  type ConditionConnector,
  type ConditionField,
  StrategyDraftPresenter,
} from '../../strategy/StrategyDraftPresenter';
import {
  ConditionEditor,
  IndicatorSelect,
  ParamInputs,
} from './ConditionEditor';

const ATTRIBUTE_LABELS: Record<string, string> = {
  indicator: 'indicator',
  operator: 'operator',
  value: 'value',
  rightIndicator: 'right indicator',
};

const OPENING_LABELS: Record<string, string> = {
  direction: 'Direction',
  risk: 'Risk',
  trigger: 'Trigger',
  limitIndicator: 'Limit price indicator',
};

function formatMissing(path: string): string {
  if (path === 'name') return 'Name';
  const openingLabel = OPENING_LABELS[path];
  if (openingLabel) return openingLabel;

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
  const name = presenter.getName();
  const direction = presenter.getDirection();
  const risk = presenter.getRisk();
  const trigger = presenter.getTrigger();
  const orderType = presenter.getOrderType();
  const limitIndicator = presenter.getLimitIndicator();
  const limitParams = presenter.getLimitParams();
  const conditions = presenter.getConditions();
  const missing = presenter.getMissing();
  const summary = missing.length === 0 ? presenter.getSummary() : null;
  const options = getConditionIndicatorOptions();
  const limitOption = options.find(
    (candidate) => candidate.id === limitIndicator
  );

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
          value={name}
          onChange={(event) =>
            update(() => presenter.setName(event.target.value))
          }
          placeholder="Strategy name"
        />
      </label>

      <fieldset className="strategy-condition">
        <legend>Opening</legend>
        <label className="strategy-field">
          <span>Direction</span>
          <select
            aria-label="Direction"
            value={direction ?? ''}
            onChange={(event) =>
              update(() =>
                presenter.setDirection(
                  event.target.value === ''
                    ? null
                    : (event.target.value as 'long' | 'short')
                )
              )
            }
          >
            <option value="">Select direction</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </label>

        <label className="strategy-field">
          <span>Trigger</span>
          <select
            aria-label="Trigger"
            value={trigger ?? ''}
            onChange={(event) =>
              update(() =>
                presenter.setTrigger(
                  event.target.value === ''
                    ? null
                    : (event.target.value as ConditionField)
                )
              )
            }
          >
            <option value="">Select trigger</option>
            {StrategyDraftPresenter.CONDITION_FIELDS.map((field) => (
              <option key={field} value={field}>
                {StrategyDraftPresenter.FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>

        <label className="strategy-field">
          <span>Risk %</span>
          <input
            type="number"
            aria-label="Risk"
            step="any"
            value={risk === null ? '' : risk}
            onChange={(event) =>
              update(() =>
                presenter.setRisk(
                  event.target.value === '' ? null : Number(event.target.value)
                )
              )
            }
          />
        </label>

        <label className="strategy-field">
          <span>Order type</span>
          <select
            aria-label="Order type"
            value={orderType}
            onChange={(event) =>
              update(() =>
                presenter.setOrderType(event.target.value as 'market' | 'limit')
              )
            }
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
        </label>

        {orderType === 'limit' && (
          <>
            <div className="strategy-field">
              <span>Limit price</span>
              <IndicatorSelect
                label="Limit price indicator"
                value={limitIndicator}
                options={options}
                onChange={(indicatorId) =>
                  update(() => presenter.setLimitIndicator(indicatorId))
                }
              />
            </div>

            {limitOption && limitOption.params.length > 0 && (
              <ParamInputs
                params={limitOption.params}
                values={limitParams}
                labelPrefix="Limit price"
                onChange={(key, value) =>
                  update(() => presenter.updateLimitParams({ [key]: value }))
                }
              />
            )}
          </>
        )}
      </fieldset>

      {StrategyDraftPresenter.CONDITION_FIELDS.map((field) => {
        const label = StrategyDraftPresenter.FIELD_LABELS[field];
        const group = conditions[field];

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

      {summary ? (
        <div className="strategy-summary">
          <h3>Summary</h3>
          <p>
            <strong>Name:</strong> {name}
          </p>
          <p>
            <strong>Direction:</strong> {summary.direction}
          </p>
          <p>
            <strong>Opening:</strong> {summary.opening}
          </p>
          <p>
            <strong>Risk:</strong> {summary.risk}
          </p>
          <p>
            <strong>Trigger:</strong> {summary.trigger}
          </p>
          {StrategyDraftPresenter.CONDITION_FIELDS.map((field) => (
            <p key={field}>
              <strong>{StrategyDraftPresenter.FIELD_LABELS[field]}:</strong>{' '}
              {summary[field]}
            </p>
          ))}
          <p className="strategy-ready">Ready to save</p>
        </div>
      ) : (
        <div className="strategy-missing">
          <p>Missing:</p>
          <ul>
            {missing.map((item) => (
              <li key={item}>{formatMissing(item)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
