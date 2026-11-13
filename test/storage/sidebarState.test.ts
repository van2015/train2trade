import { beforeEach, describe, expect, it } from 'vitest'
import { loadOpenSection, saveOpenSection } from '@/storage/sidebarState'

/** Almacén en memoria para no depender de localStorage entre tests. */
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
})

describe('sidebarState', () => {
  it('guarda y carga la sección abierta', () => {
    expect(loadOpenSection(storage)).toBeNull()

    saveOpenSection(storage, 'experimentos')

    expect(loadOpenSection(storage)).toBe('experimentos')
  })

  it('guardar null borra la clave', () => {
    saveOpenSection(storage, 'resultados')
    saveOpenSection(storage, null)

    expect(loadOpenSection(storage)).toBeNull()
  })

  it('sin storage no hay preferencia y guardar es no-op', () => {
    expect(loadOpenSection(null)).toBeNull()
    expect(() => saveOpenSection(null, 'datos')).not.toThrow()
  })

  it('un storage que lanza no rompe la UI', () => {
    const broken = {
      getItem() {
        throw new Error('denegado')
      },
      setItem() {
        throw new Error('cuota')
      },
      removeItem() {
        throw new Error('denegado')
      },
    } as unknown as Storage

    expect(loadOpenSection(broken)).toBeNull()
    expect(() => saveOpenSection(broken, 'datos')).not.toThrow()
    expect(() => saveOpenSection(broken, null)).not.toThrow()
  })

  it('un valor no normalizado se devuelve tal cual (lo normaliza App)', () => {
    storage.setItem('ui:sidebar-section', 'invented')

    expect(loadOpenSection(storage)).toBe('invented')
  })
})
