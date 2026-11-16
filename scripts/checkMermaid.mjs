/**
 * Comprueba que todos los bloques ```mermaid de los Markdown del repo siguen
 * parseando con el parser real de Mermaid (la regla de «Documentación y
 * diagramas» en AGENTS.md).
 *
 * Uso: pnpm docs:check          (todos los .md trackeados)
 *      pnpm docs:check docs/x.md (ficheros concretos)
 *
 * Sale con código ≠ 0 si algún bloque falla, listando fichero, bloque y motivo.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

// Mermaid espera entorno de navegador; lo montamos antes de importarlo.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const { default: mermaid } = await import('mermaid')
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' })

/** Ficheros .md del repo (trackeados por git); o los pasados por argumento. */
function markdownFiles(argv) {
  if (argv.length > 0) return argv
  const out = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

const BLOCK = /```mermaid[ \t]*\n([\s\S]*?)```/g
let blocks = 0
const failures = []

for (const file of markdownFiles(process.argv.slice(2))) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    failures.push({ file, index: '?', detail: 'no se pudo leer el fichero' })
    continue
  }

  let match
  let index = 0
  while ((match = BLOCK.exec(text)) !== null) {
    index += 1
    blocks += 1
    try {
      await mermaid.parse(match[1])
    } catch (error) {
      const detail = String(error?.message ?? error)
        .split('\n')
        .slice(0, 4)
        .join(' | ')
      failures.push({ file, index, detail })
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${failure.file} — bloque ${failure.index}: ${failure.detail}`)
  }
  console.error(`\n${failures.length} bloque(s) Mermaid inválido(s) de ${blocks} comprobados.`)
  process.exit(1)
}

console.log(
  `✓ ${blocks} bloque(s) Mermaid válidos en ${markdownFiles(process.argv.slice(2)).length} fichero(s).`,
)
