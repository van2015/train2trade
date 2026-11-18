import type { ReactNode } from 'react'

/** Identificadores de las secciones plegables del sidebar (plan UI, T0/Fase 3).
 *  La sección `resultados` se eliminó en la Fase 3: Historial es una pestaña.
 *  `estrategias` es la tercera sección (CRUD, §1.8 / ronda F). */
export const SIDEBAR_SECTION_IDS = ['datos', 'experimentos', 'estrategias'] as const

export type SidebarSectionId = (typeof SIDEBAR_SECTION_IDS)[number]

/** Id desconocido (p. ej. storage de otra versión) → default en el sidebar. */
export function isSidebarSectionId(value: unknown): value is SidebarSectionId {
  return SIDEBAR_SECTION_IDS.includes(value as SidebarSectionId)
}

export interface SidebarSectionProps {
  id: SidebarSectionId
  title: string
  open: boolean
  onToggle: (id: SidebarSectionId) => void
  children: ReactNode
}

/**
 * Sección plegable del sidebar (plan UI, T0). El contenido se oculta con el
 * atributo `hidden` **sin desmontar los hijos**: el estado de los paneles
 * (sesión de replay, formularios, resultados de backtest) sobrevive a plegar
 * y reabrir la sección.
 */
export function SidebarSection({ id, title, open, onToggle, children }: SidebarSectionProps) {
  const contentId = `${id}-content`

  return (
    <section className="sidebar-section" aria-label={title}>
      <button
        type="button"
        className="sidebar-section__header"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onToggle(id)}
      >
        <span className="sidebar-section__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span>{title}</span>
      </button>
      <div id={contentId} className="sidebar-section__content" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
