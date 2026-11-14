import {
  compatibleClasses,
  ConditionOp,
  RuleSpec,
  ruleOperandAliases,
  SeriesClasses,
} from '@/domain/strategies/spec'

export interface RuleEditorProps {
  /** Id único del árbol (testids; un editor por tipo de regla). */
  testId: string
  /** Etiqueta raíz accesible (va en los aria-label de todos los nodos). */
  label: string
  /** Regla actual (nodo raíz). */
  value: RuleSpec
  /** Mapa de clases (`seriesClasses`). */
  classes: SeriesClasses
  /** Alias de operación permitidos en el contexto (`operationAliases`). */
  operations: readonly string[]
  /** Añade una constante al draft y devuelve su alias (atajo de operandos, riesgo §1.8). */
  onAddConstant: () => string
  /** Emite la regla resultante. */
  onChange: (rule: RuleSpec) => void
}

/**
 * Editor de reglas como **árbol visual** (§1.8, decisión 11): condición con
 * operandos filtrados por clase (al elegir `a`, `b` solo ofrece aliados: misma
 * clase o constante) y grupos AND/OR con add-condición / add-grupo / quitar /
 * NOT por nodo. Los alias de operación (`entry`/`sl`/`tp`) solo aparecen si el
 * contexto los permite.
 */
export function RuleEditor({
  testId,
  label,
  value,
  classes,
  operations,
  onAddConstant,
  onChange,
}: RuleEditorProps) {
  const options = ruleOperandAliases(classes, operations)
  return (
    <div className="rule-tree" data-testid={testId}>
      <RuleNode
        rule={value}
        label={label}
        classes={classes}
        options={options}
        onAddConstant={onAddConstant}
        onChange={onChange}
        root
      />
    </div>
  )
}

interface RuleNodeProps {
  rule: RuleSpec
  label: string
  classes: SeriesClasses
  options: readonly string[]
  onAddConstant: () => string
  onChange: (rule: RuleSpec) => void
  /** true → sin botón "quitar" (raíz o hijo de NOT). */
  root: boolean
  /** true → sin controles NOT/quitar (hijo directo de un NOT: ya lo tiene el envoltorio). */
  bare?: boolean
  onRemove?: () => void
}

function RuleNode({
  rule,
  label,
  classes,
  options,
  onAddConstant,
  onChange,
  root,
  bare = false,
  onRemove,
}: RuleNodeProps) {
  const isNot = rule.kind === 'not'
  const toggleNot = () => onChange(isNot ? rule.rule : { kind: 'not', rule })

  const controls = bare ? null : (
    <>
      <button
        type="button"
        className="button button--ghost"
        aria-label={`${label} alternar NOT`}
        onClick={toggleNot}
      >
        NOT
      </button>
      {!root && onRemove !== undefined && (
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} quitar`}
          onClick={onRemove}
        >
          quitar
        </button>
      )}
    </>
  )

  if (rule.kind === 'condition') {
    const bOptions = secondOptions(rule.a, options, classes)
    const displayedB = bOptions.includes(rule.b) ? rule.b : (bOptions[0] ?? rule.b)

    /** Cambiar `a` reajusta `b` si deja de ser compatible (evita estado inválido). */
    const changeFirst = (a: string) => {
      const fallback = secondOptions(a, options, classes)
      const b = fallback.includes(rule.b) ? rule.b : (fallback[0] ?? rule.b)
      onChange({ ...rule, a, b })
    }

    /** Atajo (riesgo §1.8): añade una constante y la asigna al operando. */
    const quickConstant = (operand: 'a' | 'b') => {
      const alias = onAddConstant()
      onChange(operand === 'a' ? { ...rule, a: alias } : { ...rule, b: alias })
    }

    return (
      <div className="rule-node__row" data-testid={`${label}-condition`}>
        {controls}
        <select
          aria-label={`${label} operador`}
          value={rule.op}
          onChange={(event) => onChange({ ...rule, op: event.target.value as ConditionOp })}
        >
          <option value="crosses_above">cruza al alza</option>
          <option value="crosses_below">cruza a la baja</option>
          <option value=">">es mayor que</option>
          <option value="<">es menor que</option>
        </select>
        <select
          aria-label={`${label} operando a`}
          value={rule.a}
          onChange={(event) => changeFirst(event.target.value)}
        >
          {options.map((alias) => (
            <option key={alias} value={alias}>
              {alias}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} operando a añadir constante`}
          onClick={() => quickConstant('a')}
        >
          +c
        </button>
        <select
          aria-label={`${label} operando b`}
          value={displayedB}
          onChange={(event) => onChange({ ...rule, b: event.target.value })}
        >
          {bOptions.map((alias) => (
            <option key={alias} value={alias}>
              {alias}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} operando b añadir constante`}
          onClick={() => quickConstant('b')}
        >
          +c
        </button>
      </div>
    )
  }

  if (isNot) {
    return (
      <div className="rule-node" data-testid={`${label}-not`}>
        <div className="rule-node__row">{controls}</div>
        <RuleNode
          rule={rule.rule}
          label={label}
          classes={classes}
          options={options}
          onAddConstant={onAddConstant}
          onChange={(child) => onChange({ kind: 'not', rule: child })}
          root
          bare
        />
      </div>
    )
  }

  // and / or: cabecera con controles + add, y los hijos en lista.
  const isAnd = rule.kind === 'and'
  const addCondition = () => onChange({ ...rule, rules: [...rule.rules, defaultCondition()] })
  const addGroup = () =>
    onChange({ ...rule, rules: [...rule.rules, { kind: 'and', rules: [defaultCondition()] }] })

  return (
    <div className="rule-node" data-testid={`${label}-group`}>
      <div className="rule-node__row">
        {controls}
        <span>{isAnd ? 'Y (todas)' : 'O (alguna)'}</span>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} añadir condición`}
          onClick={addCondition}
        >
          + condición
        </button>
        <button
          type="button"
          className="button button--ghost"
          aria-label={`${label} añadir grupo`}
          onClick={addGroup}
        >
          + grupo
        </button>
      </div>
      <ul className="rule-tree">
        {rule.rules.map((child, index) => (
          <li key={index} className="rule-node">
            <RuleNode
              rule={child}
              label={`${label}/${index + 1}`}
              classes={classes}
              options={options}
              onAddConstant={onAddConstant}
              onChange={(next) =>
                onChange({ ...rule, rules: rule.rules.map((r, i) => (i === index ? next : r)) })
              }
              root={false}
              onRemove={
                rule.rules.length > 1
                  ? () => onChange({ ...rule, rules: rule.rules.filter((_, i) => i !== index) })
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Aliados de `a` en una condición: misma clase o constante; sin repetir `a`. */
function secondOptions(a: string, options: readonly string[], classes: SeriesClasses): string[] {
  const strict = options.filter(
    (alias) => alias !== a && compatibleClasses(classes[a], classes[alias]),
  )
  if (strict.length > 0) return strict
  return options.filter((alias) => compatibleClasses(classes[a], classes[alias]))
}

/** Condición plantilla válida en cualquier contexto (precio ↔ precio). */
export function defaultCondition(): RuleSpec {
  return { kind: 'condition', op: '>', a: 'close', b: 'open' }
}
