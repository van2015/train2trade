import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 'ghost' → acción secundaria. */
  variant?: 'ghost'
  children: ReactNode
}

/**
 * `type="button"` por defecto: un botón de acción nunca debe enviar un
 * formulario por accidente.
 */
export function Button({ variant, className, type = 'button', children, ...rest }: ButtonProps) {
  const base = variant === 'ghost' ? 'button button--ghost' : 'button'
  const classes = className === undefined ? base : `${base} ${className}`

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
