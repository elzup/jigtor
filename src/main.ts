// UI shell: file loading (picker + drag/drop), form rendering, validation, export.
// All schema/validation/render logic lives in ./core (pure & tested).
import './style.css'
import { parseSchema } from './core/parseSchema'
import { validateConfig } from './core/validateConfig'
import { parseJsonFile, serializeConfig, classifyFile } from './core/fileIo'
import { renderForm } from './core/renderForm'
import type { FieldPath } from './core/types'

type State = {
  schema: unknown | null
  config: unknown
}

const state: State = { schema: null, config: {} }

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header>
    <h1>jigtor</h1>
    <p>Load a JSON Schema + config.json, edit safely, export valid config.</p>
  </header>
  <section id="drop" class="drop">
    <label class="filebtn">schema.json<input type="file" id="schema-input" accept=".json" hidden></label>
    <label class="filebtn">config.json<input type="file" id="config-input" accept=".json" hidden></label>
    <span class="hint">or drag &amp; drop files here</span>
  </section>
  <p id="status" class="status"></p>
  <main id="form-host"></main>
  <footer>
    <button id="export" disabled>Download config.json</button>
  </footer>
`

const status = app.querySelector<HTMLParagraphElement>('#status')!
const formHost = app.querySelector<HTMLElement>('#form-host')!
const exportBtn = app.querySelector<HTMLButtonElement>('#export')!

function setAt(root: unknown, path: FieldPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  const base =
    typeof root === 'object' && root !== null && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {}
  return { ...base, [head!]: setAt(base[head!], rest, value) }
}

function rerender(): void {
  if (state.schema === null) return
  const parsed = parseSchema(state.schema)
  if (!parsed.ok) {
    status.textContent = `Schema error: ${parsed.error}`
    status.className = 'status error'
    formHost.replaceChildren()
    exportBtn.disabled = true
    return
  }
  const result = validateConfig(state.schema, state.config)
  status.textContent = result.valid
    ? 'Config is valid ✓'
    : `${result.errors.length} validation error(s)`
  status.className = result.valid ? 'status ok' : 'status error'
  exportBtn.disabled = !result.valid

  const form = renderForm(parsed.root, state.config, result.errors, (path, value) => {
    state.config = setAt(state.config, path, value)
    rerender()
  })
  formHost.replaceChildren(form)
}

async function ingest(file: File): Promise<void> {
  const text = await file.text()
  const parsed = parseJsonFile(text)
  if (!parsed.ok) {
    status.textContent = `${file.name}: ${parsed.error}`
    status.className = 'status error'
    return
  }
  const kind = classifyFile(file.name, parsed.value)
  if (kind === 'schema') state.schema = parsed.value
  else state.config = parsed.value
  rerender()
}

app.querySelector<HTMLInputElement>('#schema-input')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) {
    void f.text().then((t) => {
      const p = parseJsonFile(t)
      if (p.ok) {
        state.schema = p.value
        rerender()
      } else {
        status.textContent = p.error
      }
    })
  }
})

app.querySelector<HTMLInputElement>('#config-input')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) {
    void f.text().then((t) => {
      const p = parseJsonFile(t)
      if (p.ok) {
        state.config = p.value
        rerender()
      } else {
        status.textContent = p.error
      }
    })
  }
})

const drop = app.querySelector<HTMLElement>('#drop')!
drop.addEventListener('dragover', (e) => {
  e.preventDefault()
  drop.classList.add('dragover')
})
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'))
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  drop.classList.remove('dragover')
  for (const file of Array.from(e.dataTransfer?.files ?? [])) void ingest(file)
})

exportBtn.addEventListener('click', () => {
  const blob = new Blob([serializeConfig(state.config)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'config.json'
  a.click()
  URL.revokeObjectURL(url)
})
