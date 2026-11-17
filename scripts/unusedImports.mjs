#!/usr/bin/env node
/**
 * Detecta imports sin uso en `src/` y `test/` (o en los ficheros indicados).
 *
 *   node scripts/unusedImports.mjs              → informe; sale con código 1 si hay
 *   node scripts/unusedImports.mjs --fix        → elimina los especificadores sin uso
 *   node scripts/unusedImports.mjs <ficheros>   → alcance concreto
 *
 * Cuenta referencias al identificador fuera de las propias sentencias de import
 * (incluye usos en JSX, en `export` y en anotaciones de tipo). No toca
 * re-exports (`export { X } from …`), que son API y no import sin uso.
 */
import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIX = process.argv.includes('--fix')
const TARGETS = process.argv.slice(2).filter((a) => a !== '--fix')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const files = TARGETS.length
  ? TARGETS.map((t) => (t.startsWith('/') ? t : join(ROOT, t)))
  : [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'test'))]

let problems = 0
let fixed = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)

  const importStmts = sf.statements.filter(ts.isImportDeclaration)
  const bindings = []
  for (const st of importStmts) {
    const nb = st.importClause?.namedBindings
    if (nb && ts.isNamedImports(nb)) bindings.push({ st, elements: nb.elements })
  }
  if (bindings.length === 0) continue

  const ranges = importStmts.map((s) => [s.getStart(sf), s.end])
  const refs = new Map()
  const walkAst = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.getStart(sf)
      if (!ranges.some(([a, b]) => p >= a && p <= b)) refs.set(n.text, (refs.get(n.text) || 0) + 1)
    }
    ts.forEachChild(n, walkAst)
  }
  walkAst(sf)

  const edits = []
  for (const { st, elements } of bindings) {
    const unused = elements.filter((el) => !refs.has(el.name.text))
    if (unused.length === 0) continue
    problems += unused.length
    for (const u of unused) console.log(`  ${relative(ROOT, file)}: ${u.name.text}`)

    if (!FIX) continue
    const kept = elements.filter((el) => !unused.includes(el))
    const from = text.slice(st.moduleSpecifier.getStart(sf), st.moduleSpecifier.end)
    const start = st.getStart(sf)
    let end = st.end
    if (kept.length === 0 && !st.importClause.name) {
      while (end < text.length && text[end] === '\n') end += 1
      edits.push({ start, end, replacement: '' })
    } else if (kept.length === 0) {
      edits.push({ start, end, replacement: `import ${st.importClause.name.text} from ${from}` })
    } else {
      const spec = kept.map((el) => text.slice(el.getStart(sf), el.end).trim()).join(', ')
      edits.push({
        start,
        end,
        replacement: `import ${st.importClause.isTypeOnly ? 'type ' : ''}{ ${spec} } from ${from}`,
      })
    }
  }

  if (edits.length > 0) {
    edits.sort((a, b) => b.start - a.start)
    let out = text
    for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
    writeFileSync(file, out)
    fixed += edits.length
  }
}

if (FIX) {
  console.log(fixed === 0 ? 'ningun import sin uso ✓' : `sentencias ajustadas: ${fixed}`)
} else if (problems === 0) {
  console.log('ningun import sin uso ✓')
} else {
  console.log(`\ntotal: ${problems} (ejecuta "pnpm imports:fix" para eliminarlos)`)
  process.exitCode = 1
}
