// UI shell: loading, tabbed views (Edit | Schema), in-place live validation,
// schema inference/adjustment, default seeding, diff-confirmed export.
// All schema/validate/render/infer/defaults/diff logic lives in ./core (tested).
import './style.css'
import { parseSchema } from './core/parseSchema'
import { validateConfig } from './core/validateConfig'
import { parseJsonFile, serializeConfig, classifyFile } from './core/fileIo'
import { renderForm, refreshErrors } from './core/renderForm'
import { inferSchema } from './core/inferSchema'
import { applyDefaults } from './core/applyDefaults'
import { diffConfig, type Change } from './core/diffConfig'
import type { FieldNode, FieldPath } from './core/types'

type State = { schema: unknown | null; config: unknown; original: unknown }
const state: State = { schema: null, config: {}, original: {} }

const clone = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null))

// The diff baseline is captured post-default-seed, the FIRST time a renderable
// (schema+config) state exists, and re-captured only when NEW external data is
// loaded (file/example) — never on an in-session schema apply/infer, so user
// edits made before a schema tweak survive in the review diff (FIND-R8 fix).
let baselineEstablished = false
const markNewData = (): void => {
  baselineEstablished = false
}

// Session persistence: remember the last loaded/edited schema+config in
// localStorage so reopening the page restores it (user request: quickly recall
// the last file).
const STORE_KEY = 'jigtor:last-session'
function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ schema: state.schema, config: state.config }))
  } catch {
    /* storage unavailable/full — non-fatal */
  }
}
function restoreSaved(): boolean {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as { schema?: unknown; config?: unknown }
    if (saved.schema == null) return false
    state.schema = saved.schema
    state.config = saved.config ?? {}
    markNewData()
    return true
  } catch {
    return false
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header>
    <h1>jigtor</h1>
    <p>Load a schema + config, edit safely, review the diff, export.</p>
  </header>
  <section id="drop" class="drop">
    <label class="filebtn">schema<input type="file" id="schema-input" accept=".json" hidden></label>
    <label class="filebtn">config<input type="file" id="config-input" accept=".json" hidden></label>
    <button id="infer-schema" class="filebtn" type="button">Generate schema from config</button>
    <button id="load-example" class="filebtn" type="button">Load example</button>
    <button id="forget" class="filebtn" type="button" hidden>Forget saved</button>
    <span class="hint">or drag &amp; drop files here</span>
  </section>

  <nav class="tabs">
    <button class="tab active" data-tab="edit" type="button">Edit</button>
    <button class="tab" data-tab="schema" type="button">Schema</button>
  </nav>

  <section id="panel-edit" class="panel">
    <p id="status" class="status"></p>
    <main id="form-host"></main>
    <footer class="save-bar">
      <button id="save" type="button">Review &amp; save…</button>
    </footer>
    <div id="save-dialog" class="save-dialog" hidden></div>
  </section>

  <section id="panel-schema" class="panel" hidden>
    <p class="hint">Edit the JSON Schema directly, then apply. "Generate schema from config" seeds this from a config that ships without one.</p>
    <textarea id="schema-editor" spellcheck="false" rows="16"></textarea>
    <div class="schema-actions">
      <button id="apply-schema" type="button">Apply schema</button>
      <span id="schema-msg" class="hint"></span>
    </div>
  </section>
`

const status = app.querySelector<HTMLParagraphElement>('#status')!
const formHost = app.querySelector<HTMLElement>('#form-host')!
const schemaEditor = app.querySelector<HTMLTextAreaElement>('#schema-editor')!
const schemaMsg = app.querySelector<HTMLSpanElement>('#schema-msg')!
const saveDialog = app.querySelector<HTMLDivElement>('#save-dialog')!
const forgetBtn = app.querySelector<HTMLButtonElement>('#forget')!

let currentForm: HTMLElement | null = null

function setAt(root: unknown, path: FieldPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  const base =
    typeof root === 'object' && root !== null && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {}
  return { ...base, [head!]: setAt(base[head!], rest, value) }
}

// Live validation without rebuilding controls (REQ-R16).
function revalidate(): void {
  if (state.schema === null || currentForm === null) return
  const result = validateConfig(state.schema, state.config)
  refreshErrors(currentForm, result.errors)
  status.textContent = result.valid ? 'Config is valid ✓' : `${result.errors.length} validation error(s)`
  status.className = result.valid ? 'status ok' : 'status error'
  persist() // remember the latest edit state for quick recall
}

// Structure change (schema loaded/applied/inferred, or a new config): seed
// defaults, build the form once, sync the schema editor, validate.
function buildForm(): void {
  saveDialog.hidden = true
  if (state.schema === null) {
    status.textContent = 'Load a schema (or generate one from a config) to start editing.'
    status.className = 'status'
    formHost.replaceChildren()
    currentForm = null
    return
  }
  const parsed = parseSchema(state.schema)
  if (!parsed.ok) {
    status.textContent = `Schema error: ${parsed.error}`
    status.className = 'status error'
    formHost.replaceChildren()
    currentForm = null
    return
  }
  state.config = applyDefaults(parsed.root as FieldNode, state.config)
  currentForm = renderForm(parsed.root, state.config, [], (path, value) => {
    state.config = setAt(state.config, path, value)
    revalidate()
  })
  formHost.replaceChildren(currentForm)
  schemaEditor.value = JSON.stringify(state.schema, null, 2)
  // Capture the diff baseline (post default-seed) once per fresh data load, so
  // machine-seeded defaults stay out of the diff (FIND-R7-001) while edits made
  // before an in-session schema apply/infer are preserved (FIND-R8).
  if (!baselineEstablished) {
    state.original = clone(state.config)
    baselineEstablished = true
  }
  persist()
  forgetBtn.hidden = false // a session now exists to recall/forget
  revalidate()
}

function loadSchema(value: unknown): void {
  state.schema = value
  buildForm()
}

function loadConfig(value: unknown): void {
  state.config = value
  buildForm()
}

function loadText(text: string, forceKind?: 'schema' | 'config', name = ''): void {
  const parsed = parseJsonFile(text)
  if (!parsed.ok) {
    status.textContent = parsed.error
    status.className = 'status error'
    return
  }
  markNewData() // a file load is a fresh review session -> re-baseline the diff
  const kind = forceKind ?? classifyFile(name, parsed.value)
  if (kind === 'schema') loadSchema(parsed.value)
  else loadConfig(parsed.value)
}

// ---- tabs ----
app.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    app.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    const target = tab.dataset.tab
    app.querySelector('#panel-edit')!.toggleAttribute('hidden', target !== 'edit')
    app.querySelector('#panel-schema')!.toggleAttribute('hidden', target !== 'schema')
  })
})

// ---- file inputs / drop ----
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

// ---- schema inference / adjustment ----
app.querySelector<HTMLButtonElement>('#infer-schema')!.addEventListener('click', () => {
  if (typeof state.config !== 'object' || state.config === null || Array.isArray(state.config)) {
    status.textContent = 'Load an object config first to generate a schema.'
    status.className = 'status error'
    return
  }
  loadSchema(inferSchema(state.config))
  schemaMsg.textContent = 'generated from config — adjust as needed'
  ;(app.querySelector('.tab[data-tab="schema"]') as HTMLButtonElement).click()
})

app.querySelector<HTMLButtonElement>('#apply-schema')!.addEventListener('click', () => {
  const parsed = parseJsonFile(schemaEditor.value)
  if (!parsed.ok) {
    schemaMsg.textContent = parsed.error
    return
  }
  schemaMsg.textContent = 'applied'
  loadSchema(parsed.value)
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
      markNewData() // fresh session -> re-baseline
      buildForm()
    })
    .catch((e) => {
      status.textContent = `Could not load example: ${String(e)}`
      status.className = 'status error'
    })
})

// ---- save: review diff, then export (allowed even when invalid) ----
function renderChange(c: Change): HTMLElement {
  const row = document.createElement('li')
  row.className = `change change-${c.kind}`
  const where = c.path.length ? c.path.join('.') : '(root)'
  const fmt = (v: unknown) => (v === undefined ? '∅' : JSON.stringify(v))
  const detail = c.kind === 'added' ? `+ ${fmt(c.after)}` : c.kind === 'removed' ? `− ${fmt(c.before)}` : `${fmt(c.before)} → ${fmt(c.after)}`
  row.textContent = `${c.kind.toUpperCase()}  ${where}: ${detail}`
  return row
}

function download(): void {
  const blob = new Blob([serializeConfig(state.config)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'config.json'
  a.click()
  URL.revokeObjectURL(url)
}

app.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => {
  if (state.schema === null) return
  const changes = diffConfig(state.original, state.config)
  const result = validateConfig(state.schema, state.config)

  saveDialog.replaceChildren()
  const title = document.createElement('h3')
  title.textContent = 'Review changes'
  saveDialog.appendChild(title)

  if (!result.valid) {
    const warn = document.createElement('p')
    warn.className = 'status error'
    warn.textContent = `⚠ ${result.errors.length} validation error(s) — you can still save.`
    saveDialog.appendChild(warn)
  }

  if (changes.length === 0) {
    const none = document.createElement('p')
    none.className = 'hint'
    none.textContent = 'No changes from the loaded config.'
    saveDialog.appendChild(none)
  } else {
    const list = document.createElement('ul')
    list.className = 'change-list'
    for (const c of changes) list.appendChild(renderChange(c))
    saveDialog.appendChild(list)
  }

  const actions = document.createElement('div')
  actions.className = 'schema-actions'
  const dl = document.createElement('button')
  dl.type = 'button'
  dl.textContent = 'Download config.json'
  dl.addEventListener('click', () => {
    download()
    state.original = clone(state.config) // new baseline after a save
    saveDialog.hidden = true
  })
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => (saveDialog.hidden = true))
  actions.append(dl, cancel)
  saveDialog.appendChild(actions)
  saveDialog.hidden = false
})

// ---- session persistence: quick recall of the last loaded/edited file ----
forgetBtn.addEventListener('click', () => {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
  forgetBtn.hidden = true
  state.schema = null
  state.config = {}
  markNewData()
  buildForm()
  status.textContent = 'Cleared saved session.'
})

// ---- startup: restore the last session if present ----
const restored = restoreSaved()
buildForm()
if (restored) {
  forgetBtn.hidden = false
  status.textContent = 'Restored your last session — load a file to start fresh.'
  status.className = 'status'
}
