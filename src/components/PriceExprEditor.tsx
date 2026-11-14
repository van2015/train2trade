import { PriceExpr, series, times, formatPriceExpr } from '@/domain/strategies/priceExpr'

export interface PriceExprEditorProps {
  /** Id único del campo (testids). */
  id: string
  /** Etiqueta accesible del campo (va en los aria-label de cada control). */
  label: string
  /** Expresión actual (puede no ser representable en forma plana). */
  value: PriceExpr
  /** Alias disponibles como operandos (`priceOperandAliases`). */
  options: readonly string[]
  /** Emite la expresión resultante en forma plana (suma de productos). */
  onChange: (expr: PriceExpr) => void
}

/** Término plano: signo + producto de series. */
interface Term {
  sign: '+' | '-'
  factors: string[]
}

/**
 * Editor de expresiones de precio en **suma de productos** (enmienda 15):
 * `fast + two * slow` → términos con signo, cada término un producto de series.
 * Sin paréntesis ni división: si la expresión cargada no se puede escribir en
 * esa forma (solo posible si se creó fuera de la UI) se muestra el aviso
 * "no editable" y se conserva el valor original.
 *
 * Componente sin estado propio: cada interacción reconstruye la expresión y la
 * emite por `onChange` (el padre es quien guarda el draft).
 */
export function PriceExprEditor({ id, label, value, options, onChange }: PriceExprEditorProps) {
  const terms = toTerms(value)

  if (terms === null) {
    return (
      <div className="field" data-testid={id}>
        <span>{label}</span>
        <p className="panel-warning" data-testid={`${id}-unportable`}>
          Expresión no editable en el formulario: {formatPriceExpr(value)}
        </p>
      </div>
    )
  }

  const defaultFactor = options[0] ?? 'close'

  const emit = (next: Term[]) => onChange(fromTerms(next))

  const updateTerm = (index: number, patch: Partial<Term>) =>
    emit(terms.map((term, i) => (i === index ? { ...term, ...patch } : term)))

  const updateFactor = (termIndex: number, factorIndex: number, alias: string) =>
    updateTerm(termIndex, {
      factors:
        terms[termIndex]?.factors.map((factor, i) => (i === factorIndex ? alias : factor)) ?? [],
    })

  const addFactor = (termIndex: number) =>
    updateTerm(termIndex, {
      factors: [...(terms[termIndex]?.factors ?? []), defaultFactor],
    })

  const removeFactor = (termIndex: number, factorIndex: number) =>
    updateTerm(termIndex, {
      factors: (terms[termIndex]?.factors ?? []).filter((_, i) => i !== factorIndex),
    })

  const addTerm = () => emit([...terms, { sign: '-', factors: [defaultFactor] }])

  const removeTerm = (index: number) => emit(terms.filter((_, i) => i !== index))

  /** Opciones del select: incluye el valor actual aunque ya no esté en `options`. */
  const opts = (current: string) => (options.includes(current) ? options : [current, ...options])

  return (
    <div className="field" data-testid={id}>
      <span>{label}</span>

      {terms.map((term, termIndex) => (
        <div className="rule-node__row" key={termIndex}>
          {termIndex > 0 && (
            <select
              aria-label={`${label} término ${termIndex + 1} signo`}
              value={term.sign}
              onChange={(event) => updateTerm(termIndex, { sign: event.target.value as '+' | '-' })}
            >
              <option value="+">+</option>
              <option value="-">−</option>
            </select>
          )}

          {term.factors.map((factor, factorIndex) => (
            <span className="rule-node__row" key={factorIndex}>
              {factorIndex > 0 && <span aria-hidden="true">×</span>}
              <select
                aria-label={`${label} término ${termIndex + 1} factor ${factorIndex + 1}`}
                value={factor}
                onChange={(event) => updateFactor(termIndex, factorIndex, event.target.value)}
              >
                {opts(factor).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {term.factors.length > 1 && (
                <button
                  type="button"
                  className="button button--ghost"
                  aria-label={`${label} término ${termIndex + 1} quitar factor ${factorIndex + 1}`}
                  onClick={() => removeFactor(termIndex, factorIndex)}
                >
                  ✕
                </button>
              )}
            </span>
          ))}

          <button
            type="button"
            className="button button--ghost"
            aria-label={`${label} término ${termIndex + 1} añadir factor`}
            onClick={() => addFactor(termIndex)}
          >
            × factor
          </button>

          {terms.length > 1 && (
            <button
              type="button"
              className="button button--ghost"
              aria-label={`${label} quitar término ${termIndex + 1}`}
              onClick={() => removeTerm(termIndex)}
            >
              ✕ término
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className="button button--ghost"
        aria-label={`Añadir término a ${label}`}
        onClick={addTerm}
      >
        + término
      </button>
    </div>
  )
}

/** Descompone la expresión en términos planos; `null` si no es representable. */
function toTerms(expr: PriceExpr): Term[] | null {
  const terms: Term[] = []
  return decompose(expr, '+') ? terms : null

  function decompose(node: PriceExpr, sign: '+' | '-'): boolean {
    if (node.kind === 'series') {
      terms.push({ sign, factors: [node.id] })
      return true
    }
    if (node.op === '*') {
      const factors = factorsOf(node)
      if (factors === null) return false
      terms.push({ sign, factors })
      return true
    }
    if (node.op === '+') return decompose(node.left, sign) && decompose(node.right, sign)
    if (node.op === '-') return decompose(node.left, sign) && decompose(node.right, flip(sign))
    return false // división: no representable en la forma plana
  }
}

/** Cadena de productos: `a * b * c` → ['a','b','c']; el resto → `null`. */
function factorsOf(node: PriceExpr): string[] | null {
  if (node.kind === 'series') return [node.id]
  if (node.op !== '*') return null
  const left = factorsOf(node.left)
  const right = factorsOf(node.right)
  return left === null || right === null ? null : [...left, ...right]
}

function flip(sign: '+' | '-'): '+' | '-' {
  return sign === '+' ? '-' : '+'
}

/** Reconstruye la expresión (asociativa por la izquierda) desde los términos. */
function fromTerms(terms: readonly Term[]): PriceExpr {
  const product = (factors: readonly string[]): PriceExpr => {
    const [head, ...tail] = factors
    let expr = series(head ?? 'close')
    for (const id of tail) expr = times(expr, series(id))
    return expr
  }

  const [first, ...rest] = terms
  let expr = product(first?.factors ?? ['close'])
  for (const term of rest) {
    expr = { kind: 'binary', op: term.sign, left: expr, right: product(term.factors) }
  }
  return expr
}
