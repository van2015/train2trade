import type { HTMLAttributes } from 'react'

/** Texto auxiliar de un panel (clase `panel-hint`): estado vacío, pista o aviso breve. */
export function Hint(props: HTMLAttributes<HTMLParagraphElement>) {
  return <p className="panel-hint" {...props} />
}
