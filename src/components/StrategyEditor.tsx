import { useState } from 'react'
import { Candle } from '@/domain/candles/candle'
import { evaluatePriceExpr, PriceExpr, series } from '@/domain/strategies/priceExpr'
import {
  buildStrategy,
  IndicatorSpec,
  operationAliases,
  priceOperandAliases,
  RuleSpec,
  SeriesClasses,
  seriesClasses,
  StrategySpec,
  TriggerAction,
  TriggerSpec,
} from '@/domain/strategies/spec'
import { PriceExprEditor } from './PriceExprEditor'
import { RuleEditor, defaultCondition } from './RuleEditor'

export interface StrategyEditorProps {
  /** Título del editor: "Crear estrategia" o "Editar <name>@<version>". */
  title: string
  /** Spec en edición: copia de trabajo **sin** `id` (la clave se recalcula al guardar). */
  spec: StrategySpec
  /** Velas cargadas: para el aviso de niveles invertidos (enmienda 16). */
  candles: readonly Candle[]
  /** Error de validación/persistencia del panel (null = sin error). */
  error: string | null
  /** Emite el draft al guardar (el panel valida y persiste). */
  onSave: (spec: StrategySpec) => void
  onCancel: () => void
}

type LevelKey = 'takeProfit' | 'stopLoss'

/**
 * Editor de plantilla de estrategias (§1.8): formulario por bloques —
 * nombre, indicadores agrupados por clase, entrada (regla + ejecución +
 * precio), TP/SL, triggers, salida por regla y veto — con **deshacer** y el
 * aviso de niveles invertidos (enmienda 16: solo avisa, no bloquea). El estado
 * del draft vive aquí; la validación y la persistencia las hace el panel.
 */
export function StrategyEditor({
  title,
  spec,
  candles,
  error,
  onSave,
  onCancel,
}: StrategyEditorProps) {
  const [draft, setDraft] = useState(spec)
  const [past, setPast] = useState<readonly StrategySpec[]>([])

  /** Aplica una transformación y guarda la versión anterior para deshacer. */
  const update = (next: (current: StrategySpec) => StrategySpec) => {
    // Dedupe: dos updates en el mismo evento (atajo de constante) comparten
    // el `draft` del cierre → una sola entrada de historial.
    setPast((history) =>
      history[history.length - 1] === draft ? history : [...history.slice(-49), draft],
    )
    setDraft(next)
  }

  const undo = () => {
    const previous = past[past.length - 1]
    if (previous === undefined) return
    setPast((history) => history.slice(0, -1))
    setDraft(previous)
  }

  /**
   * Atajo junto a los operandos de una regla (riesgo §1.8): crea una
   * constante nueva (`c1`, `c2`…) con valor 30 y devuelve su alias para que
   * la regla la use de inmediato.
   */
  const quickAddConstant = (): string => {
    const taken = new Set(draft.indicators.map((indicator) => indicator.alias))
    let index = 1
    while (taken.has(`c${index}`)) index += 1
    const alias = `c${index}`
    update((d) => ({ ...d, indicators: [...d.indicators, { alias, kind: 'const', value: 30 }] }))
    return alias
  }

  const classes: SeriesClasses = seriesClasses(draft)
  const warning = levelWarning(draft, candles)

  /* ------------------------------- indicadores ------------------------------ */

  const setIndicator = (index: number, next: IndicatorSpec) =>
    update((d) => ({
      ...d,
      indicators: d.indicators.map((indicator, i) => (i === index ? next : indicator)),
    }))

  const removeIndicator = (index: number) =>
    update((d) => ({ ...d, indicators: d.indicators.filter((_, i) => i !== index) }))

  const addIndicator = (next: IndicatorSpec) =>
    update((d) => ({ ...d, indicators: [...d.indicators, next] }))

  const changeIndicatorKind = (index: number, kind: IndicatorSpec['kind']) => {
    const current = draft.indicators[index]
    if (current === undefined || current.kind === kind) return
    const next: IndicatorSpec =
      kind === 'const'
        ? { alias: current.alias, kind: 'const', value: 30 }
        : { alias: current.alias, kind, period: current.kind === 'const' ? 14 : current.period }
    setIndicator(index, next)
  }

  const indicatorRow = (indicator: IndicatorSpec, index: number) => (
    <div className="rule-node__row" key={index} data-testid={`indicator-${index}`}>
      <label className="field">
        <span>Alias</span>
        <input
          type="text"
          aria-label={`Indicador ${index + 1} alias`}
          value={indicator.alias}
          onChange={(event) => setIndicator(index, { ...indicator, alias: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Tipo</span>
        <select
          aria-label={`Indicador ${index + 1} tipo`}
          value={indicator.kind}
          onChange={(event) =>
            changeIndicatorKind(index, event.target.value as IndicatorSpec['kind'])
          }
        >
          <option value="sma">SMA</option>
          <option value="ema">EMA</option>
          <option value="rsi">RSI</option>
          <option value="const">Constante</option>
        </select>
      </label>
      {indicator.kind === 'const' ? (
        <label className="field">
          <span>Valor</span>
          <input
            type="number"
            step="any"
            aria-label={`Indicador ${index + 1} valor`}
            value={indicator.value}
            onChange={(event) =>
              setIndicator(index, { ...indicator, value: Number(event.target.value) })
            }
          />
        </label>
      ) : (
        <label className="field">
          <span>Periodo</span>
          <input
            type="number"
            min={1}
            step={1}
            aria-label={`Indicador ${index + 1} periodo`}
            value={indicator.period}
            onChange={(event) =>
              setIndicator(index, { ...indicator, period: Number(event.target.value) })
            }
          />
        </label>
      )}
      <button
        type="button"
        className="button button--ghost"
        aria-label={`Quitar indicador ${index + 1}`}
        onClick={() => removeIndicator(index)}
      >
        ✕
      </button>
    </div>
  )

  const indicatorGroup = (
    groupClass: 'price' | 'oscillator' | 'constant',
    heading: string,
    addLabel: string,
    make: () => IndicatorSpec,
  ) => {
    const rows = draft.indicators
      .map((indicator, index) => ({ indicator, index }))
      .filter(({ indicator }) => groupOf(indicator) === groupClass)
    return (
      <div data-testid={`indicators-${groupClass}`}>
        <h4 className="strategy-editor__block">{heading}</h4>
        {rows.map(({ indicator, index }) => indicatorRow(indicator, index))}
        <button
          type="button"
          className="button button--ghost"
          aria-label={addLabel}
          onClick={() => addIndicator(make())}
        >
          {addLabel}
        </button>
      </div>
    )
  }

  /* --------------------------------- entrada -------------------------------- */

  const changeEntryExecution = (execution: 'market' | 'limit') =>
    update((d) => ({
      ...d,
      entry:
        execution === 'limit'
          ? {
              rule: d.entry.rule,
              execution: 'limit',
              price: d.entry.execution === 'limit' ? d.entry.price : series('close'),
            }
          : { rule: d.entry.rule, execution: 'market' },
    }))

  const setEntryRule = (rule: RuleSpec) =>
    update((d) => ({
      ...d,
      entry: d.entry.execution === 'limit' ? { ...d.entry, rule } : { rule, execution: 'market' },
    }))

  /* -------------------------------- TP / SL --------------------------------- */

  const setLevel = (key: LevelKey, level: { price: PriceExpr; execution: 'limit' | 'market' }) =>
    update((d) => ({ ...d, [key]: level }))

  const toggleLevel = (key: LevelKey, active: boolean) =>
    update((d) => {
      if (!active) {
        const copy: StrategySpec = { ...d }
        delete copy[key]
        return copy
      }
      return { ...d, [key]: { price: series('close'), execution: 'market' as const } }
    })

  const levelBlock = (key: LevelKey, label: string) => {
    const level = draft[key]
    return (
      <div data-testid={key}>
        <div className="field field--check">
          <label>
            <input
              type="checkbox"
              checked={level !== undefined}
              onChange={(event) => toggleLevel(key, event.target.checked)}
            />
            {label}
          </label>
        </div>
        {level !== undefined && (
          <>
            <PriceExprEditor
              id={`${key}-price`}
              label={`${label} precio`}
              value={level.price}
              options={priceOperandAliases(classes, operationAliases(key))}
              onChange={(price) => setLevel(key, { ...level, price })}
            />
            <label className="field">
              <span>{label} ejecución</span>
              <select
                aria-label={`${label} ejecución`}
                value={level.execution}
                onChange={(event) =>
                  setLevel(key, {
                    ...level,
                    execution: event.target.value as 'limit' | 'market',
                  })
                }
              >
                <option value="market">A mercado</option>
                <option value="limit">Límite</option>
              </select>
            </label>
          </>
        )}
      </div>
    )
  }

  /* -------------------------------- triggers -------------------------------- */

  const triggers = draft.triggers ?? []

  const setTrigger = (index: number, next: TriggerSpec) =>
    update((d) => ({
      ...d,
      triggers: (d.triggers ?? []).map((trigger, i) => (i === index ? next : trigger)),
    }))

  const addTrigger = () =>
    update((d) => ({
      ...d,
      triggers: [
        ...(d.triggers ?? []),
        { price: series('close'), action: 'request_exit', execution: 'market' },
      ],
    }))

  const removeTrigger = (index: number) =>
    update((d) => {
      const rest = (d.triggers ?? []).filter((_, i) => i !== index)
      const copy: StrategySpec = { ...d }
      if (rest.length === 0) delete copy.triggers
      else copy.triggers = rest
      return copy
    })

  const changeTriggerAction = (index: number, action: TriggerAction) => {
    const trigger = triggers[index]
    if (trigger === undefined) return
    const needsFraction = action === 'request_add' || action === 'request_reduce'
    setTrigger(index, {
      ...trigger,
      action,
      fraction: needsFraction ? (trigger.fraction ?? 1) : undefined,
    })
  }

  /* ------------------------------ salida y veto ----------------------------- */

  const toggleRule = (key: 'exitRule' | 'invalidation', active: boolean) =>
    update((d) => {
      if (!active) {
        const copy: StrategySpec = { ...d }
        delete copy[key]
        return copy
      }
      return { ...d, [key]: defaultCondition() }
    })

  /* --------------------------------- guardado ------------------------------- */

  return (
    <section
      className="strategy-editor"
      data-testid="strategy-editor"
      aria-label="Editor de estrategia"
    >
      <h3 className="panel-title">{title}</h3>

      <div className="panel-form">
        <label className="field">
          <span>Nombre</span>
          <input
            type="text"
            value={draft.name}
            onChange={(event) => update((d) => ({ ...d, name: event.target.value }))}
          />
        </label>
      </div>

      <h4 className="strategy-editor__block">Indicadores</h4>
      {indicatorGroup(
        'price',
        'Indicadores de precio (SMA/EMA)',
        'Añadir indicador de precio',
        () => ({ alias: '', kind: 'sma', period: 20 }),
      )}
      {indicatorGroup('oscillator', 'Osciladores (RSI)', 'Añadir oscilador', () => ({
        alias: '',
        kind: 'rsi',
        period: 14,
      }))}
      {indicatorGroup('constant', 'Constantes', 'Añadir constante', () => ({
        alias: '',
        kind: 'const',
        value: 30,
      }))}

      <h4 className="strategy-editor__block">Entrada</h4>
      <div className="panel-form">
        <label className="field">
          <span>Ejecución</span>
          <select
            aria-label="Ejecución de entrada"
            value={draft.entry.execution}
            onChange={(event) => changeEntryExecution(event.target.value as 'market' | 'limit')}
          >
            <option value="market">A mercado</option>
            <option value="limit">Límite</option>
          </select>
        </label>
      </div>
      {draft.entry.execution === 'limit' && (
        <PriceExprEditor
          id="entry-price"
          label="Precio de entrada"
          value={draft.entry.price}
          options={priceOperandAliases(classes, operationAliases('entry.price'))}
          onChange={(price) =>
            update((d) => ({
              ...d,
              entry: d.entry.execution === 'limit' ? { ...d.entry, price } : d.entry,
            }))
          }
        />
      )}
      <RuleEditor
        testId="entry-rule"
        label="Regla de entrada"
        value={draft.entry.rule}
        classes={classes}
        operations={operationAliases('entry.rule')}
        onAddConstant={quickAddConstant}
        onChange={setEntryRule}
      />

      <h4 className="strategy-editor__block">Take profit / Stop loss</h4>
      {levelBlock('takeProfit', 'Take profit')}
      {levelBlock('stopLoss', 'Stop loss')}
      {warning !== null && (
        <p className="panel-warning" data-testid="level-warning">
          {warning}
        </p>
      )}

      <h4 className="strategy-editor__block">Triggers</h4>
      {triggers.map((trigger, index) => (
        <div className="rule-node__row" key={index} data-testid={`trigger-${index}`}>
          <PriceExprEditor
            id={`trigger-price-${index}`}
            label={`Trigger ${index + 1} precio`}
            value={trigger.price}
            options={priceOperandAliases(classes, operationAliases('trigger'))}
            onChange={(price) => setTrigger(index, { ...trigger, price })}
          />
          <label className="field">
            <span>Acción</span>
            <select
              aria-label={`Trigger ${index + 1} acción`}
              value={trigger.action}
              onChange={(event) => changeTriggerAction(index, event.target.value as TriggerAction)}
            >
              <option value="request_entry">Entrar</option>
              <option value="request_add">Añadir posición</option>
              <option value="request_reduce">Reducir posición</option>
              <option value="request_exit">Salir</option>
            </select>
          </label>
          <label className="field">
            <span>Ejecución</span>
            <select
              aria-label={`Trigger ${index + 1} ejecución`}
              value={trigger.execution}
              onChange={(event) =>
                setTrigger(index, {
                  ...trigger,
                  execution: event.target.value as 'limit' | 'market',
                })
              }
            >
              <option value="market">A mercado</option>
              <option value="limit">Límite</option>
            </select>
          </label>
          {(trigger.action === 'request_add' || trigger.action === 'request_reduce') && (
            <label className="field">
              <span>Fracción</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                aria-label={`Trigger ${index + 1} fracción`}
                value={trigger.fraction ?? 1}
                onChange={(event) =>
                  setTrigger(index, { ...trigger, fraction: Number(event.target.value) })
                }
              />
            </label>
          )}
          <button
            type="button"
            className="button button--ghost"
            aria-label={`Quitar trigger ${index + 1}`}
            onClick={() => removeTrigger(index)}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button--ghost"
        aria-label="Añadir trigger"
        onClick={addTrigger}
      >
        + trigger
      </button>

      <h4 className="strategy-editor__block">Salida y veto</h4>
      <div className="field field--check">
        <label>
          <input
            type="checkbox"
            checked={draft.exitRule !== undefined}
            onChange={(event) => toggleRule('exitRule', event.target.checked)}
          />
          Salida por regla
        </label>
      </div>
      {draft.exitRule !== undefined && (
        <RuleEditor
          testId="exit-rule"
          label="Regla de salida"
          value={draft.exitRule}
          classes={classes}
          operations={operationAliases('exitRule')}
          onAddConstant={quickAddConstant}
          onChange={(rule) => update((d) => ({ ...d, exitRule: rule }))}
        />
      )}
      <div className="field field--check">
        <label>
          <input
            type="checkbox"
            checked={draft.invalidation !== undefined}
            onChange={(event) => toggleRule('invalidation', event.target.checked)}
          />
          Veto (invalidación)
        </label>
      </div>
      {draft.invalidation !== undefined && (
        <RuleEditor
          testId="invalidation-rule"
          label="Regla de veto"
          value={draft.invalidation}
          classes={classes}
          operations={operationAliases('invalidation')}
          onAddConstant={quickAddConstant}
          onChange={(rule) => update((d) => ({ ...d, invalidation: rule }))}
        />
      )}

      {error !== null && (
        <p className="status status--error" role="status" data-testid="strategy-editor-error">
          {error}
        </p>
      )}

      <div className="panel-actions">
        <button type="button" className="button" disabled={past.length === 0} onClick={undo}>
          Deshacer
        </button>
        <button type="button" className="button" onClick={() => onSave(draft)}>
          Guardar
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  )
}

/** Grupo de clase de un indicador (mismo criterio que `classOfKind`). */
function groupOf(indicator: IndicatorSpec): 'price' | 'oscillator' | 'constant' {
  if (indicator.kind === 'const') return 'constant'
  return indicator.kind === 'rsi' ? 'oscillator' : 'price'
}

/**
 * Aviso de niveles invertidos (enmienda 16): evalúa TP/SL/entrada sobre la
 * última vela. **Solo avisa, no bloquea**; con un draft aún inválido o sin
 * datos suficientes no dice nada (el error lo dirá "Guardar").
 */
function levelWarning(spec: StrategySpec, candles: readonly Candle[]): string | null {
  if (candles.length === 0) return null
  if (spec.takeProfit === undefined && spec.stopLoss === undefined) return null

  let context: ReturnType<ReturnType<typeof buildStrategy>['buildContext']>
  try {
    context = buildStrategy(spec).buildContext(candles)
  } catch {
    return null
  }

  const tp =
    spec.takeProfit !== undefined ? evaluatePriceExpr(spec.takeProfit.price, context) : null
  const sl = spec.stopLoss !== undefined ? evaluatePriceExpr(spec.stopLoss.price, context) : null
  const entry =
    spec.entry.execution === 'limit' ? evaluatePriceExpr(spec.entry.price, context) : null

  if (tp !== null && sl !== null && tp <= sl) {
    return 'Take profit no está por encima del Stop loss: se dispararía al instante.'
  }
  if (tp !== null && entry !== null && tp <= entry) {
    return 'Take profit no está por encima del precio de entrada: se dispararía al instante.'
  }
  if (sl !== null && entry !== null && sl >= entry) {
    return 'Stop loss no está por debajo del precio de entrada: se dispararía al instante.'
  }
  return null
}
