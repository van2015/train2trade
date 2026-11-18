import type { ReactNode } from 'react'

export interface FieldProps {
  label: ReactNode
  htmlFor?: string
  check?: boolean
  children: ReactNode
}

/**
 * Campo etiquetado, la unidad mínima de formulario (`className="field"`), en
 * sus tres formas de marcado:
 *
 * - por defecto: `<label class="field"><span>texto</span>{control}</label>`
 * - `htmlFor`: `<div class="field"><label for>{texto}</label>{control}</div>`
 * - `check`: `<div class="field field--check"><label>{control}{texto}</label></div>`
 */
export function Field({ label, htmlFor, check = false, children }: FieldProps) {
  if (check) {
    return (
      <div className="field field--check">
        <label htmlFor={htmlFor}>
          {children}
          {label}
        </label>
      </div>
    )
  }

  if (htmlFor !== undefined) {
    return (
      <div className="field">
        <label htmlFor={htmlFor}>{label}</label>
        {children}
      </div>
    )
  }

  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
