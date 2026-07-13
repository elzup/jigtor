// UI shell: file loading (picker + drag/drop), form rendering, validation,
// schema inference/adjustment, default seeding, export.
// All schema/validation/render/infer/defaults logic lives in ./core (pure & tested).
import './style.css'
import { parseSchema } from './core/parseSchema'
import { validateConfig } from './core/validateConfig'
import { parseJsonFile, serializeConfig, classifyFile } from './core/fileIo'
import { renderForm } from './core/renderForm'
import { inferSchema } from './core/inferSchema'
import { applyDefaults } from './core/applyDefaults'
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
    <p>Load a JSON Schema + config, edit safely, export valid config.</p>
  </header>
  <section id="drop" class="drop">
    <label class="filebtn">schema<input type="file" id="schema-input" accept=".json" hidden></label>
    <label class="filebtn">config<input type="file" id="config-input" accept=".json" hidden></label>
    <button id="infer-schema" class="filebtn" type="button">Generate schema from config</button>
    <button id="load-example" class="filebtn" type="button">Load example</button>
    <span class="hint">or drag &amp; drop files here</span>
  </section>
  <p id="status" class="status"></p>
  <main id="form-host"></main>
  <details id="schema-panel">
    <summary>Schema (edit &amp; adjust)</summary>
    <textarea id="schema-editor" spellcheck="false" rows="12"></textarea>
    <div class="schema-actions">
      <button id="apply-schema" type="button">Apply schema</button>
      <span id="schema-msg" class="hint"></span>
    </div>
  </details>
  <footer>
    <button id="export" disabled>Download config</button>
  </footer>
`

const status = app.querySelector<HTMLParagraphElement>('#status')!
const formHost = app.querySelector<HTMLElement>('#form-host')!
const exportBtn = app.querySelector<HTMLButtonElement>('#export')!
const schemaEditor = app.querySelector<HTMLTextAreaElement>('#schema-editor')!
const schemaMsg = app.querySelector<HTMLSpanElement>('#schema-msg')!

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
  status.textContent = result.valid ? 'Config is valid ✓' : `${result.errors.length} validation error(s)`
  status.className = result.valid ? 'status ok' : 'status error'
  exportBtn.disabled = !result.valid

  const form = renderForm(parsed.root, state.config, result.errors, (path, value) => {
    state.config = setAt(state.config, path, value)
    rerender()
  })
  formHost.replaceChildren(form)
}

// Load-time refresh: seed missing config values from schema default/example,
// sync the schema editor, then render. Kept out of per-keystroke rerender so it
// never re-adds a value the user just deleted.
function refresh(): void {
  if (state.schema !== null) {
    const parsed = parseSchema(state.schema)
    if (parsed.ok) state.config = applyDefaults(parsed.root, state.config)
    schemaEditor.value = JSON.stringify(state.schema, null, 2)
  }
  rerender()
}

function loadText(text: string, forceKind?: 'schema' | 'config', name = ''): void {
  const parsed = parseJsonFile(text)
  if (!parsed.ok) {
    status.textContent = parsed.error
    status.className = 'status error'
    return
  }
  const kind = forceKind ?? classifyFile(name, parsed.value)
  if (kind === 'schema') state.schema = parsed.value
  else state.config = parsed.value
  refresh()
}

app.querySelector<HTMLInputElement>('#schema-input')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void f.text().then((t) => loadText(t, 'schema', f.name))
})

app.querySelector<HTMLInputElement>('#config-input')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void f.text().then((t) => loadText(t, 'config', f.name))
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
  for (const file of Array.from(e.dataTransfer?.files ?? [])) {
    void file.text().then((t) => loadText(t, undefined, file.name))
  }
})

// Generate a draft schema from the current config, then let the user adjust it.
app.querySelector<HTMLButtonElement>('#infer-schema')!.addEventListener('click', () => {
  if (typeof state.config !== 'object' || state.config === null || Array.isArray(state.config)) {
    status.textContent = 'Load an object config first to generate a schema.'
    status.className = 'status error'
    return
  }
  state.schema = inferSchema(state.config)
  refresh()
  app.querySelector<HTMLDetailsElement>('#schema-panel')!.open = true
})

// Apply a hand-edited schema from the textarea.
app.querySelector<HTMLButtonElement>('#apply-schema')!.addEventListener('click', () => {
  const parsed = parseJsonFile(schemaEditor.value)
  if (!parsed.ok) {
    schemaMsg.textContent = parsed.error
    return
  }
  schemaMsg.textContent = 'applied'
  state.schema = parsed.value
  refresh()
})

app.querySelector<HTMLButtonElement>('#load-example')!.addEventListener('click', () => {
  Promise.all([
    fetch('examples/config.schema.json').then((r) => r.text()),
    fetch('examples/config.json').then((r) => r.text()),
  ])
    .then(([schemaText, configText]) => {
      const s = parseJsonFile(schemaText)
      const c = parseJsonFile(configText)
      if (s.ok) state.schema = s.value
      if (c.ok) state.config = c.value
      refresh()
    })
    .catch((e) => {
      status.textContent = `Could not load example: ${String(e)}`
      status.className = 'status error'
    })
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
