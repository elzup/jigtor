// UI shell: loading, tabbed views (Edit | Schema), in-place live validation,
// schema inference/adjustment, default seeding, diff-confirmed save.
// All schema/validate/render/infer/defaults/diff logic lives in ./core (tested).
import './style.css'
import { parseSchema } from './core/parseSchema'
import { validateConfig } from './core/validateConfig'
import {
  parseJsonFile,
  serializeConfig,
  classifyFile,
  prepareConfigReconnect,
} from './core/fileIo'
import { renderForm, refreshErrors, refreshFieldMeta } from './core/renderForm'
import { inferSchema } from './core/inferSchema'
import { applyDefaults } from './core/applyDefaults'
import { diffConfig } from './core/diffConfig'
import { lineDiff } from './core/lineDiff'
import {
  valueType,
  defaultForType,
  coerceType,
  jsonGet,
  jsonSet,
  jsonDelete,
  jsonRenameKey,
  jsonInsert,
  jsonMoveItem,
  type JsonType,
  type JsonPath,
} from './core/jsonEdit'
import { resolveSchemaAt } from './core/schemaAt'
import { orderLike } from './core/orderLike'
import {
  recordSnapshot,
  fieldHistory,
  historyPaths,
  parseHistory,
  type SaveHistory,
  type FieldHistoryEntry,
} from './core/history'
import {
  flattenSchema,
  editSchemaField,
  addSchemaField,
  removeSchemaField,
  sampleFromSchema,
  type SchemaRow,
} from './core/schemaEdit'
import type { FieldNode, FieldPath } from './core/types'
import exampleSchemaText from '../examples/.jigtor/schema.json?raw'
import exampleConfigText from '../examples/config.json?raw'
import { installTauriFileSystem } from './tauri-fs'

// When running inside the Tauri desktop shell, back the File System Access seam
// with native Rust fs; a no-op in browsers, so this same module drives both.
installTauriFileSystem()

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const

type State = { schema: unknown | null; config: unknown; original: unknown }
const state: State = { schema: null, config: {}, original: {} }

const clone = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null))

type WritableFileStreamLike = {
  write: (data: string | BufferSource | Blob) => Promise<void>
  close: () => Promise<void>
}
type FileSystemFileHandleLike = {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<WritableFileStreamLike>
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
}
type FileSystemDirectoryHandleLike = {
  name: string
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandleLike>
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandleLike>
  // Native handles (and the Tauri shim) enumerate entries via values(); used to
  // list a folder's JSON files as config candidates. Read only name/kind here.
  values?: () => AsyncIterableIterator<{ name: string; kind: 'file' | 'directory' }>
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
}
type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean
    types?: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<FileSystemFileHandleLike[]>
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
}

let configFileHandle: FileSystemFileHandleLike | null = null
let projectDirectoryHandle: FileSystemDirectoryHandleLike | null = null
let currentConfigName: string | null = null // which file the project tree marks as "editing"
const filePickerWindow = window as FilePickerWindow
const canUseFileSystemAccess = (): boolean =>
  typeof filePickerWindow.showOpenFilePicker === 'function'

// Root-anchored dotted path shared with the Edit form (REQ-R17): [] -> "." ,
// ['a','b'] -> ".a.b". Replaces the old "(root)" placeholder everywhere.
const fmtPath = (path: readonly string[]): string => (path.length ? `.${path.join('.')}` : '.')

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

// spec:history (REQ-H07): per-field save history, persisted across sessions.
const HISTORY_KEY = 'jigtor:history'
let history: SaveHistory = loadHistory()
function loadHistory(): SaveHistory {
  try {
    return parseHistory(localStorage.getItem(HISTORY_KEY)) // REQ-H07: never throws
  } catch {
    return [] // localStorage access itself denied -> empty history
  }
}
function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    /* non-fatal */
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
    <p>Open config.json, edit safely, review the diff, save back to the same file.</p>
  </header>
  <section id="drop" class="drop">
    <div class="drop-primary">
      <button id="open-project" class="filebtn primary" type="button">Open project folder</button>
      <span class="hint">or drag &amp; drop files here</span>
    </div>
    <details class="more" id="more">
      <summary>Other sources</summary>
      <div class="more-actions">
        <button id="open-config" class="filebtn" type="button">Open config.json</button>
        <button id="open-schema" class="filebtn" type="button">Open schema</button>
        <label class="filebtn" id="import-config-label">Import config<input type="file" id="config-input" accept=".json" hidden></label>
        <label class="filebtn" id="import-schema-label">Import schema<input type="file" id="schema-input" accept=".json" hidden></label>
        <button id="infer-schema" class="filebtn" type="button">Generate schema from config</button>
        <button id="load-example" class="filebtn" type="button">Load example</button>
        <button id="forget" class="filebtn" type="button" hidden>Forget saved</button>
      </div>
    </details>
    <div id="project-picker" class="project-picker" hidden></div>
  </section>

  <nav class="tabs">
    <button class="tab active" data-tab="edit" type="button">Edit</button>
    <button class="tab" data-tab="schema" type="button">Schema</button>
    <button class="tab" data-tab="history" type="button">History</button>
  </nav>

  <section id="panel-edit" class="panel">
    <details id="project-tree" class="project-tree-view" hidden>
      <summary>Project files</summary>
      <div id="project-tree-body"></div>
    </details>
    <p id="status" class="status"></p>
    <div id="schema-recommend" class="recommend" hidden></div>
    <div class="edit-mode-bar">
      <div class="mode-switch" role="tablist">
        <button id="mode-block-btn" class="mode active" data-mode="block" type="button">Block</button>
        <button id="mode-tree-btn" class="mode" data-mode="tree" type="button">Tree</button>
      </div>
      <span class="undo-redo">
        <button id="undo" class="filebtn" type="button" title="Undo (Ctrl/Cmd+Z)" disabled>↶ Undo</button>
        <button id="redo" class="filebtn" type="button" title="Redo (Ctrl/Cmd+Shift+Z)" disabled>↷ Redo</button>
      </span>
      <label class="compact-toggle"><input type="checkbox" id="compact-mode"> Compact fields</label>
    </div>
    <div id="mode-block">
      <main id="form-host"></main>
    </div>
    <div id="mode-tree" hidden>
      <p class="hint">Direct JSON editing — no schema needed. Edit values, change
        types, rename keys, add / remove / reorder. Controls panel on the right.</p>
      <div class="tree-cols">
        <div id="tree-host" class="tree-edit"></div>
        <aside id="tree-controls" class="tree-controls"></aside>
      </div>
    </div>
    <details id="config-json" class="config-json" open>
      <summary>Live diff — whole file (vs last load / save)</summary>
      <pre id="config-preview"></pre>
    </details>
    <footer class="save-bar">
      <button id="save" type="button">Review &amp; save…</button>
      <span id="dirty-note" class="dirty-note" hidden></span>
    </footer>
    <div id="save-dialog" class="save-dialog" hidden></div>
  </section>

  <section id="panel-schema" class="panel" hidden>
    <p class="hint">Edit each field's type, default and validation. Add or remove fields. "Generate schema from config" seeds this from a config that ships without one.</p>
    <div class="schema-cols">
      <div id="schema-fields" class="schema-fields"></div>
      <div class="schema-preview">
        <h4>Sample config preview</h4>
        <pre id="sample-preview"></pre>
      </div>
    </div>
    <details id="raw-schema">
      <summary>Raw JSON</summary>
      <textarea id="schema-editor" spellcheck="false" rows="12"></textarea>
      <div class="schema-actions">
        <button id="apply-schema" type="button">Apply raw JSON</button>
        <span id="schema-msg" class="hint"></span>
      </div>
    </details>
  </section>

  <section id="panel-history" class="panel" hidden>
    <p class="hint">Saved changes, grouped by field. Edits are only recorded once you save.</p>
    <div id="history-host" class="history-host"></div>
  </section>
`

const status = app.querySelector<HTMLParagraphElement>('#status')!
const formHost = app.querySelector<HTMLElement>('#form-host')!
const schemaEditor = app.querySelector<HTMLTextAreaElement>('#schema-editor')!
const schemaMsg = app.querySelector<HTMLSpanElement>('#schema-msg')!
const saveDialog = app.querySelector<HTMLDivElement>('#save-dialog')!
const forgetBtn = app.querySelector<HTMLButtonElement>('#forget')!
const schemaFields = app.querySelector<HTMLDivElement>('#schema-fields')!
const samplePreview = app.querySelector<HTMLPreElement>('#sample-preview')!
const saveBtn = app.querySelector<HTMLButtonElement>('#save')!
const dirtyNote = app.querySelector<HTMLSpanElement>('#dirty-note')!
const configPreview = app.querySelector<HTMLPreElement>('#config-preview')!
const historyHost = app.querySelector<HTMLDivElement>('#history-host')!
const treeHost = app.querySelector<HTMLDivElement>('#tree-host')!
const treeControls = app.querySelector<HTMLElement>('#tree-controls')!
const modeBlock = app.querySelector<HTMLDivElement>('#mode-block')!
const modeTree = app.querySelector<HTMLDivElement>('#mode-tree')!
const compactToggle = app.querySelector<HTMLInputElement>('#compact-mode')!

// Edit tab has two views of the same config: Block (schema-driven form) and Tree
// (schema-independent JSON editor). Switching to Block re-syncs the form from the
// current config; switching to Tree renders the editor + the controls panel.
function setEditMode(mode: 'block' | 'tree'): void {
  modeBlock.hidden = mode !== 'block'
  modeTree.hidden = mode !== 'tree'
  app.querySelectorAll<HTMLButtonElement>('.mode-switch .mode').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode),
  )
  if (mode === 'tree') {
    renderTree()
    renderTreeControls()
  } else if (state.schema !== null) {
    buildForm()
  }
}
app.querySelectorAll<HTMLButtonElement>('.mode-switch .mode').forEach((btn) => {
  btn.addEventListener('click', () => setEditMode(btn.dataset.mode === 'tree' ? 'tree' : 'block'))
})

// ---- undo / redo (config edits across both modes) ----
const undoBtn = app.querySelector<HTMLButtonElement>('#undo')!
const redoBtn = app.querySelector<HTMLButtonElement>('#redo')!
const undoStack: unknown[] = []
const redoStack: unknown[] = []
const UNDO_LIMIT = 200

function updateUndoButtons(): void {
  undoBtn.disabled = undoStack.length === 0
  redoBtn.disabled = redoStack.length === 0
}

// Record the pre-edit config so the change can be undone. Called by every edit
// path (Block form onChange, Tree edits) right before state.config is replaced.
function pushUndo(prev: unknown): void {
  undoStack.push(prev)
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack.length = 0 // a new edit invalidates the redo branch
  lastEditPath = null // a discrete edit ends any in-progress coalescing burst
  updateUndoButtons()
}

// Coalesce consecutive edits to the SAME field into one undo entry, so a slider
// drag (Block form fires onChange per input) or a run of keystrokes undoes to the
// value from before the burst — i.e. "on release", not per intermediate change.
let lastEditPath: string | null = null
function pushUndoCoalesced(path: FieldPath): void {
  const key = JSON.stringify(path)
  if (key === lastEditPath) return // same field, same burst — keep the pre-burst snapshot
  pushUndo(state.config)
  lastEditPath = key // pushUndo reset this to null; mark the burst's field
}

// Re-render every view from the current state.config after undo/redo.
function refreshAllViews(): void {
  if (state.schema !== null) buildForm() // rebuilds block form + preview + validate
  else {
    renderConfigPreview()
    updateDirty()
    persist()
  }
  renderTree()
  renderTreeControls()
}

function doUndo(): void {
  if (undoStack.length === 0) return
  redoStack.push(state.config)
  state.config = undoStack.pop()
  lastEditPath = null
  updateUndoButtons()
  refreshAllViews()
}
function doRedo(): void {
  if (redoStack.length === 0) return
  undoStack.push(state.config)
  state.config = redoStack.pop()
  lastEditPath = null
  updateUndoButtons()
  refreshAllViews()
}
undoBtn.addEventListener('click', doUndo)
redoBtn.addEventListener('click', doRedo)
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.key.toLowerCase() !== 'z') return
  e.preventDefault()
  if (e.shiftKey) doRedo()
  else doUndo()
})

// Compact field layout (user request): dotted path + description on a small top
// line, label + input below. Pure CSS re-flow of the existing form DOM; the
// preference is remembered across sessions.
const COMPACT_KEY = 'jigtor:compact'
function applyCompact(on: boolean): void {
  formHost.classList.toggle('compact', on)
  try {
    localStorage.setItem(COMPACT_KEY, on ? '1' : '0')
  } catch {
    /* non-fatal */
  }
}
compactToggle.checked = (() => {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1'
  } catch {
    return false
  }
})()
applyCompact(compactToggle.checked)
compactToggle.addEventListener('change', () => applyCompact(compactToggle.checked))
const projectPicker = app.querySelector<HTMLDivElement>('#project-picker')!
const schemaRecommend = app.querySelector<HTMLDivElement>('#schema-recommend')!
const projectTree = app.querySelector<HTMLDetailsElement>('#project-tree')!
const projectTreeBody = app.querySelector<HTMLDivElement>('#project-tree-body')!
const openProjectBtn = app.querySelector<HTMLButtonElement>('#open-project')!
const openConfigBtn = app.querySelector<HTMLButtonElement>('#open-config')!
const openSchemaBtn = app.querySelector<HTMLButtonElement>('#open-schema')!
const moreDetails = app.querySelector<HTMLDetailsElement>('#more')!

// Simplified entry (user request): "Open project folder" is the single primary
// action; everything else folds into "Other sources". Where the File System
// Access API is missing (Safari/Firefox), the FS-only openers can't work — hide
// them and auto-expand the fold so the Import pickers are the visible path.
if (!canUseFileSystemAccess()) {
  openProjectBtn.hidden = true
  openConfigBtn.hidden = true
  openSchemaBtn.hidden = true
  moreDetails.open = true
}

// "Dirty" = the config has unsaved changes since the last load/save. Derived
// from the same diff baseline used by the save dialog; drives the save prompt.
let isDirty = false
function updateDirty(): void {
  const count = state.schema === null ? 0 : diffConfig(state.original, state.config).length
  isDirty = count > 0
  saveBtn.textContent = isDirty ? `Review & save… (${count})` : 'Review & save…'
  saveBtn.classList.toggle('dirty', isDirty)
  dirtyNote.hidden = !isDirty
  dirtyNote.textContent = isDirty ? `${count} unsaved change(s) — not saved yet` : ''
}

// Live whole-file diff of the config as it is edited (user request): the entire
// file is shown, with every line since the loaded/saved baseline marked as
// added / removed / unchanged so pending edits are visible in place before save.
function fillWholeFileDiff(target: HTMLElement): void {
  const before = (JSON.stringify(state.original, null, 2) ?? 'null').split('\n')
  const after = (JSON.stringify(state.config, null, 2) ?? 'null').split('\n')
  const frag = document.createDocumentFragment()
  for (const row of lineDiff(before, after)) {
    const line = document.createElement('span')
    line.className = `diff-line diff-${row.kind}`
    const mark = row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '
    line.textContent = mark + row.text
    frag.appendChild(line)
  }
  target.replaceChildren(frag)
}

function renderConfigPreview(): void {
  fillWholeFileDiff(configPreview)
}

// spec:history UI — group saved changes by field (dotted path), newest field
// first, entries oldest→newest within each field.
function fmtVal(v: unknown): string {
  return v === undefined ? '∅' : JSON.stringify(v)
}
function fmtTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function historyEntryRow(e: FieldHistoryEntry): HTMLElement {
  const li = document.createElement('li')
  li.className = `change change-${e.kind}`
  const detail =
    e.kind === 'added'
      ? `+ ${fmtVal(e.after)}`
      : e.kind === 'removed'
        ? `− ${fmtVal(e.before)}`
        : `${fmtVal(e.before)} → ${fmtVal(e.after)}`
  li.textContent = `${fmtTime(e.at)}  ${detail}`
  return li
}
function renderHistoryTab(): void {
  historyHost.replaceChildren()
  const paths = historyPaths(history)
  if (paths.length === 0) {
    const p = document.createElement('p')
    p.className = 'hint'
    p.textContent = 'No saved changes yet. Edit a field and save to start the history.'
    historyHost.appendChild(p)
    return
  }
  for (const path of paths) {
    const group = document.createElement('section')
    group.className = 'history-field'
    const h = document.createElement('code')
    h.className = 'field-path'
    h.textContent = fmtPath(path)
    group.appendChild(h)
    const list = document.createElement('ul')
    list.className = 'change-list'
    for (const e of fieldHistory(history, path)) list.appendChild(historyEntryRow(e))
    group.appendChild(list)
    historyHost.appendChild(group)
  }
}

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

function getAt(root: unknown, path: FieldPath): unknown {
  let cur = root
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

// Immutably remove the key at `path` (used by reset when the baseline lacked it).
function deleteAt(root: unknown, path: FieldPath): unknown {
  if (path.length === 0) return root
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return root
  const [head, ...rest] = path
  const obj = root as Record<string, unknown>
  if (!(head! in obj)) return root
  if (rest.length === 0) {
    const { [head!]: _drop, ...keep } = obj
    return keep
  }
  return { ...obj, [head!]: deleteAt(obj[head!], rest) }
}

// REQ-R18: revert one field to its last-saved baseline value, then rebuild the
// form so the input reflects it (a deliberate click -> input-identity loss is fine).
function resetField(path: FieldPath): void {
  pushUndo(state.config)
  const base = getAt(state.original, path)
  state.config = base === undefined ? deleteAt(state.config, path) : setAt(state.config, path, base)
  buildForm()
}

// Live validation without rebuilding controls (REQ-R16).
function revalidate(): void {
  if (state.schema === null || currentForm === null) return
  const result = validateConfig(state.schema, state.config)
  refreshErrors(currentForm, result.errors)
  refreshFieldMeta(currentForm, state.original, state.config, resetField) // REQ-R18
  status.textContent = result.valid ? 'Config is valid ✓' : `${result.errors.length} validation error(s)`
  status.className = result.valid ? 'status ok' : 'status error'
  persist() // remember the latest edit state for quick recall
  updateDirty()
  renderConfigPreview()
}

// Structure change (schema loaded/applied/inferred, or a new config): seed
// defaults, build the form once, sync the schema editor, validate.
function buildForm(): void {
  saveDialog.hidden = true
  renderSchemaTab() // keep the structured schema editor + sample preview in sync
  if (state.schema === null) {
    status.textContent = 'Load a schema (or generate one from a config) to start editing.'
    status.className = 'status'
    formHost.replaceChildren()
    currentForm = null
    updateDirty()
    renderConfigPreview()
    return
  }
  const parsed = parseSchema(state.schema)
  if (!parsed.ok) {
    status.textContent = `Schema error: ${parsed.error}`
    status.className = 'status error'
    formHost.replaceChildren()
    currentForm = null
    updateDirty()
    renderConfigPreview()
    return
  }
  state.config = applyDefaults(parsed.root as FieldNode, state.config)
  currentForm = renderForm(parsed.root, state.config, [], (path, value) => {
    pushUndoCoalesced(path) // slider drag / keystroke burst -> one undo entry
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
  } else {
    // In-session schema apply/infer may seed NEW defaulted fields. applyDefaults
    // only fills missing keys, so seeding the same defaults into the baseline
    // folds those machine values in WITHOUT touching user edits — otherwise a
    // schema-added defaulted field would read as a permanent change and its
    // reset button would be a dead no-op (FIND-A1: deleteAt then re-seed loop).
    state.original = applyDefaults(parsed.root as FieldNode, state.original)
  }
  persist()
  forgetBtn.hidden = false // a session now exists to recall/forget
  revalidate()
}

// ---- Tree (real edit) mode: schema-independent, Firestore-style JSON editor ----
const JSON_TYPES: JsonType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']
const collapsedPaths = new Set<string>() // pathKey -> collapsed (default expanded)
const pathKey = (path: JsonPath): string => JSON.stringify(path)

// Apply an immutable edit to the config, then refresh the tree and the shared
// preview / validation / dirty / persist pipeline (works with or without a schema).
function applyTreeEdit(next: unknown): void {
  pushUndo(state.config)
  state.config = next
  renderTree()
  renderTreeControls()
  if (state.schema !== null && currentForm !== null) {
    revalidate() // also refreshes preview / dirty / persist
  } else {
    renderConfigPreview()
    updateDirty()
    persist()
  }
}

function renderTree(): void {
  const type = valueType(state.config)
  if (type === 'object' || type === 'array') {
    treeHost.replaceChildren(treeContainerBody(state.config, []))
  } else {
    // A bare primitive root: offer a single value editor at the root path.
    treeHost.replaceChildren(treeLeafRow('(value)', state.config, [], { root: true }))
  }
}

// All leaf (non-container) paths of the config, in document order.
function flattenLeaves(value: unknown, path: JsonPath, out: Array<[JsonPath, unknown]>): void {
  const type = valueType(value)
  if (type === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenLeaves(v, [...path, k], out)
    }
  } else if (type === 'array') {
    ;(value as unknown[]).forEach((v, i) => flattenLeaves(v, [...path, i], out))
  } else if (path.length > 0) {
    out.push([path, value])
  }
}

const dotPath = (path: JsonPath): string => (path.length ? path.join('.') : '(root)')

// Control panel (right of the Tree editor): a compact dashboard of every leaf —
// bounded numbers as sliders / progress bars, booleans as toggles, enums as
// selects, everything else read-only. Edits flow through the same pipeline.
function renderTreeControls(): void {
  const leaves: Array<[JsonPath, unknown]> = []
  flattenLeaves(state.config, [], leaves)
  const frag = document.createDocumentFragment()
  for (const [path, value] of leaves) {
    const row = document.createElement('div')
    row.className = 'tc-row'
    const label = document.createElement('code')
    label.className = 'tc-label'
    label.textContent = dotPath(path)
    row.append(label, treeControl(path, value))
    frag.appendChild(row)
  }
  if (leaves.length === 0) {
    frag.appendChild(metaSpan('No fields yet.', 'hint'))
  }
  treeControls.replaceChildren(frag)
}

function treeControl(path: JsonPath, value: unknown): HTMLElement {
  const type = valueType(value)
  const sub = state.schema !== null ? resolveSchemaAt(state.schema, path) : null
  if (type === 'number' && sub && typeof sub.minimum === 'number' && typeof sub.maximum === 'number') {
    return tcGauge(sub.minimum, sub.maximum, value as number, path)
  }
  if (type === 'boolean') {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'tc-toggle'
    box.checked = value === true
    box.addEventListener('change', () => applyTreeEdit(jsonSet(state.config, path, box.checked)))
    return box
  }
  if (sub && Array.isArray(sub.enum) && (type === 'string' || type === 'number')) {
    return treeEnumSelect(sub.enum, value, path)
  }
  return metaSpan(type === 'string' ? String(value) : JSON.stringify(value), 'tc-value')
}

// A range slider backed by a proportional fill bar; commits on release.
function tcGauge(min: number, max: number, value: number, path: JsonPath): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'tc-gauge'
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(min)
  range.max = String(max)
  range.step = '1'
  range.value = String(value)
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  const bar = document.createElement('div')
  bar.className = 'tc-bar'
  bar.style.setProperty('--fill', `${pct}%`)
  const readout = metaSpan(`${value}/${max}`, 'tc-readout')
  range.addEventListener('input', () => {
    bar.style.setProperty('--fill', `${((Number(range.value) - min) / (max - min)) * 100}%`)
    readout.textContent = `${range.value}/${max}`
  })
  range.addEventListener('change', () => {
    const n = Number(range.value)
    if (Number.isFinite(n)) applyTreeEdit(jsonSet(state.config, path, n))
  })
  wrap.append(bar, range, readout)
  return wrap
}

function treeContainerBody(container: unknown, path: JsonPath): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'jt-children'
  const entries: Array<[string | number, unknown]> = Array.isArray(container)
    ? container.map((v, i) => [i, v])
    : Object.entries(container as Record<string, unknown>)
  for (const [key, value] of entries) {
    wrap.appendChild(treeEntry(key, value, path, Array.isArray(container)))
  }
  wrap.appendChild(treeAddRow(container, path))
  return wrap
}

function treeEntry(
  key: string | number,
  value: unknown,
  parentPath: JsonPath,
  inArray: boolean,
): HTMLElement {
  const path = [...parentPath, key]
  const type = valueType(value)
  if (type === 'object' || type === 'array') return treeContainerRow(key, value, path, inArray)
  return treeLeafRow(key, value, path, { inArray })
}

// Object/array node: a header row (key, type, controls) + collapsible children.
function treeContainerRow(
  key: string | number,
  value: unknown,
  path: JsonPath,
  inArray: boolean,
): HTMLElement {
  const li = document.createElement('div')
  li.className = 'jt-node'
  const header = document.createElement('div')
  header.className = 'jt-row'
  const collapsed = collapsedPaths.has(pathKey(path))
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'jt-toggle'
  toggle.textContent = collapsed ? '▸' : '▾'
  toggle.addEventListener('click', () => {
    if (collapsed) collapsedPaths.delete(pathKey(path))
    else collapsedPaths.add(pathKey(path))
    renderTree()
  })
  const count = Array.isArray(value) ? value.length : Object.keys(value as object).length
  header.append(
    toggle,
    treeKeyCell(key, path, inArray),
    treeTypeSelect(value, path),
    metaSpan(Array.isArray(value) ? `[${count}]` : `{${count}}`),
  )
  if (JSON.stringify(jsonGet(state.original, path)) !== JSON.stringify(value)) {
    header.append(metaSpan('●', 'jt-dot')) // subtree changed since baseline
  }
  header.append(treeActions(path, inArray))
  li.appendChild(header)
  if (!collapsed) li.appendChild(treeContainerBody(value, path))
  return li
}

function treeLeafRow(
  key: string | number,
  value: unknown,
  path: JsonPath,
  opts: { inArray?: boolean; root?: boolean },
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'jt-row'
  if (!opts.root) row.append(spacer(), treeKeyCell(key, path, opts.inArray ?? false))
  row.append(treeTypeSelect(value, path), treeValueEditor(value, path))
  if (opts.root) return row
  row.append(treeActions(path, opts.inArray ?? false))
  const meta = treeChangedMeta(path, value) // "was <baseline>" + reset, when dirty
  if (meta) row.append(meta)

  // Per-field save history (with each version's timestamp), toggled per row.
  const entries = fieldHistory(history, path.map(String))
  if (entries.length === 0) return row
  const leaf = document.createElement('div')
  leaf.className = 'jt-leaf'
  const panel = document.createElement('div')
  panel.className = 'jt-history'
  panel.hidden = true
  for (const e of entries) panel.appendChild(treeHistoryRow(e.at, e.after, path))
  const toggle = iconButton(`🕘 ${entries.length}`, 'field history', () => (panel.hidden = !panel.hidden))
  toggle.classList.add('jt-hist-btn')
  row.append(toggle)
  leaf.append(row, panel)
  return leaf
}

// "was <baseline>" chip + reset button, shown only when the leaf differs from
// the loaded/saved baseline (state.original) — mirrors the Edit form's meta.
function treeChangedMeta(path: JsonPath, current: unknown): HTMLElement | null {
  const base = jsonGet(state.original, path)
  if (JSON.stringify(base) === JSON.stringify(current)) return null
  const wrap = document.createElement('span')
  wrap.className = 'jt-meta jt-changed'
  wrap.append(metaSpan(base === undefined ? 'new' : `was ${JSON.stringify(base)}`, 'jt-was'))
  const reset = iconButton('↩', 'reset to saved', () =>
    applyTreeEdit(base === undefined ? jsonDelete(state.config, path) : jsonSet(state.config, path, base)),
  )
  reset.classList.add('jt-reset')
  wrap.append(reset)
  return wrap
}

// One past version of a field: its timestamp + value, click to restore.
function treeHistoryRow(at: number, value: unknown, path: JsonPath): HTMLElement {
  const row = document.createElement('div')
  row.className = 'jt-hist-row'
  const val = document.createElement('button')
  val.type = 'button'
  val.className = 'jt-hist-val'
  val.textContent = JSON.stringify(value)
  val.title = 'restore this value'
  val.addEventListener('click', () => applyTreeEdit(jsonSet(state.config, path, value)))
  row.append(metaSpan(fmtTime(at), 'jt-hist-time'), val)
  return row
}

// Key cell: array indices are read-only labels; object keys rename on change.
function treeKeyCell(key: string | number, path: JsonPath, inArray: boolean): HTMLElement {
  if (inArray) return metaSpan(`${key}`, 'jt-index')
  const input = document.createElement('input')
  input.className = 'jt-key'
  input.value = String(key)
  input.setAttribute('aria-label', 'key')
  const parentPath = path.slice(0, -1)
  input.addEventListener('change', () => {
    const next = input.value.trim()
    if (next === '' || next === String(key)) {
      input.value = String(key)
      return
    }
    applyTreeEdit(jsonRenameKey(state.config, parentPath, String(key), next))
  })
  return input
}

function treeTypeSelect(value: unknown, path: JsonPath): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'jt-type'
  select.setAttribute('aria-label', 'type')
  const current = valueType(value)
  for (const t of JSON_TYPES) {
    const opt = document.createElement('option')
    opt.value = t
    opt.textContent = t
    if (t === current) opt.selected = true
    select.appendChild(opt)
  }
  select.addEventListener('change', () => {
    const t = select.value as JsonType
    applyTreeEdit(jsonSet(state.config, path, coerceType(value, t)))
  })
  return select
}

// Type-appropriate leaf editor; commits on change (blur/enter) to avoid caret
// jumps. When a schema governs this path, upgrade to its richer widget — enum ->
// radio (≤6) / select, bounded number -> slider + input — matching the Edit form.
function treeValueEditor(value: unknown, path: JsonPath): HTMLElement {
  const type = valueType(value)
  const sub = state.schema !== null ? resolveSchemaAt(state.schema, path) : null
  const enumVals = sub && Array.isArray(sub.enum) ? sub.enum : null
  if (enumVals && (type === 'string' || type === 'number')) {
    return enumVals.length <= 6
      ? treeEnumRadios(enumVals, value, path)
      : treeEnumSelect(enumVals, value, path)
  }
  if (type === 'number' && sub && typeof sub.minimum === 'number' && typeof sub.maximum === 'number') {
    return treeSlider(sub.minimum, sub.maximum, value, path)
  }
  if (type === 'boolean') {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'jt-bool'
    box.checked = value === true
    box.addEventListener('change', () => applyTreeEdit(jsonSet(state.config, path, box.checked)))
    return box
  }
  if (type === 'null') return metaSpan('null', 'jt-null')
  const input = document.createElement('input')
  input.className = 'jt-value'
  input.type = type === 'number' ? 'number' : 'text'
  input.value = type === 'number' ? String(value) : String(value ?? '')
  input.addEventListener('change', () => {
    const next = type === 'number' ? Number(input.value) : input.value
    if (type === 'number' && !Number.isFinite(next as number)) {
      input.value = String(value)
      return
    }
    applyTreeEdit(jsonSet(state.config, path, next))
  })
  return input
}

// enum (> 6 options): dropdown. Option index maps back to the typed enum value.
function treeEnumSelect(options: unknown[], value: unknown, path: JsonPath): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'jt-value jt-enum'
  options.forEach((opt, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = String(opt)
    if (opt === value) o.selected = true
    select.appendChild(o)
  })
  select.addEventListener('change', () => applyTreeEdit(jsonSet(state.config, path, options[Number(select.value)])))
  return select
}

// enum (≤ 6 options): radio group.
let radioGroupSeq = 0
function treeEnumRadios(options: unknown[], value: unknown, path: JsonPath): HTMLElement {
  const group = document.createElement('span')
  group.className = 'jt-radios'
  const name = `jt-radio-${radioGroupSeq++}`
  options.forEach((opt, i) => {
    const label = document.createElement('label')
    label.className = 'jt-radio'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = name
    input.checked = opt === value
    input.addEventListener('change', () => applyTreeEdit(jsonSet(state.config, path, options[i])))
    label.append(input, document.createTextNode(String(opt)))
    group.appendChild(label)
  })
  return group
}

// number with both bounds: range slider paired with a free number input. The
// range updates the number live while dragging and commits on release.
function treeSlider(min: number, max: number, value: unknown, path: JsonPath): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'jt-slider'
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(min)
  range.max = String(max)
  range.step = '1' // default coarse step; the paired number input takes any value
  const num = document.createElement('input')
  num.type = 'number'
  num.className = 'jt-value'
  if (typeof value === 'number') {
    range.value = String(value)
    num.value = String(value)
  }
  const commit = (raw: string): void => {
    const n = Number(raw)
    if (Number.isFinite(n)) applyTreeEdit(jsonSet(state.config, path, n))
  }
  range.addEventListener('input', () => (num.value = range.value))
  range.addEventListener('change', () => commit(range.value))
  num.addEventListener('change', () => commit(num.value))
  wrap.append(range, num)
  return wrap
}

// Per-entry controls: delete, plus reorder for array items.
function treeActions(path: JsonPath, inArray: boolean): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'jt-actions'
  if (inArray) {
    const index = Number(path[path.length - 1])
    const arrayPath = path.slice(0, -1)
    wrap.append(
      iconButton('↑', 'move up', () => applyTreeEdit(jsonMoveItem(state.config, arrayPath, index, -1))),
      iconButton('↓', 'move down', () => applyTreeEdit(jsonMoveItem(state.config, arrayPath, index, 1))),
    )
  }
  wrap.append(iconButton('✕', 'delete', () => applyTreeEdit(jsonDelete(state.config, path))))
  return wrap
}

// "Add child" affordance under a container: a button (arrays) or key + button.
function treeAddRow(container: unknown, path: JsonPath): HTMLElement {
  const row = document.createElement('div')
  row.className = 'jt-row jt-add'
  row.appendChild(spacer())
  if (Array.isArray(container)) {
    row.appendChild(
      iconButton('+ item', 'add item', () =>
        applyTreeEdit(jsonInsert(state.config, path, '', defaultForType('string'))),
      ),
    )
    return row
  }
  const keyInput = document.createElement('input')
  keyInput.className = 'jt-key'
  keyInput.placeholder = 'new key'
  const add = (): void => {
    const key = keyInput.value.trim()
    if (key === '') return
    keyInput.value = ''
    applyTreeEdit(jsonInsert(state.config, path, key, defaultForType('string')))
  }
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add()
  })
  row.append(keyInput, iconButton('+ key', 'add key', add))
  return row
}

function iconButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'jt-btn'
  btn.textContent = text
  btn.setAttribute('aria-label', label)
  btn.addEventListener('click', onClick)
  return btn
}

function metaSpan(text: string, cls = 'jt-meta'): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = cls
  span.textContent = text
  return span
}

function spacer(): HTMLSpanElement {
  return metaSpan('', 'jt-spacer')
}

function loadSchema(value: unknown): void {
  state.schema = value
  schemaRecommend.hidden = true // a schema now exists — drop the recommendation
  buildForm()
}

function loadConfig(value: unknown): void {
  state.config = value
  buildForm()
}

function loadConfigFromHandle(value: unknown, handle: FileSystemFileHandleLike): void {
  configFileHandle = handle
  loadConfig(value)
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
  else {
    configFileHandle = null
    exitProjectMode() // imported/dropped config replaces the project context
    loadConfig(parsed.value)
  }
}

// ---- structured schema editor (Schema tab) ----
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const parseDefault = (raw: string): unknown => {
  const t = raw.trim()
  if (t === '') return undefined
  try {
    return JSON.parse(t)
  } catch {
    return raw
  }
}
const numOrUndef = (raw: string): number | undefined => {
  const t = raw.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isNaN(n) ? undefined : n
}
const strOrUndef = (raw: string): string | undefined => (raw.trim() === '' ? undefined : raw)

// A schema edit is an in-session change: keep the diff baseline (no markNewData).
const commitSchema = (next: unknown): void => {
  state.schema = next
  buildForm()
}

function conInput(
  label: string,
  value: unknown,
  onCommit: (raw: string) => void,
  inputType = 'text',
): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'schema-con'
  const inp = document.createElement('input')
  inp.type = inputType
  inp.placeholder = label
  if (value !== undefined) inp.value = String(value)
  inp.addEventListener('change', () => onCommit(inp.value)) // commit on blur/enter, not per-keystroke
  wrap.append(document.createTextNode(label), inp)
  return wrap
}

function schemaFieldRow(row: SchemaRow): HTMLElement {
  const el = document.createElement('div')
  el.className = 'schema-row'
  const p = row.path

  const head = document.createElement('div')
  head.className = 'schema-row-head'
  const code = document.createElement('code')
  code.textContent = fmtPath(p)

  const typeSel = document.createElement('select')
  for (const t of FIELD_TYPES) {
    const o = document.createElement('option')
    o.value = t
    o.textContent = t
    typeSel.appendChild(o)
  }
  typeSel.value = row.type
  typeSel.addEventListener('change', () =>
    commitSchema(editSchemaField(state.schema, p, { type: typeSel.value })),
  )

  const reqLabel = document.createElement('label')
  reqLabel.className = 'schema-req'
  const reqCb = document.createElement('input')
  reqCb.type = 'checkbox'
  reqCb.checked = row.required
  reqCb.addEventListener('change', () =>
    commitSchema(editSchemaField(state.schema, p, { required: reqCb.checked })),
  )
  reqLabel.append(reqCb, document.createTextNode(' req'))

  const rm = document.createElement('button')
  rm.type = 'button'
  rm.className = 'schema-rm'
  rm.textContent = '✕'
  rm.addEventListener('click', () => commitSchema(removeSchemaField(state.schema, p)))

  head.append(code, typeSel, reqLabel, rm)
  el.appendChild(head)

  const cons = document.createElement('div')
  cons.className = 'schema-cons'
  if (row.type !== 'object') {
    cons.appendChild(
      conInput('default', row.default === undefined ? '' : JSON.stringify(row.default), (v) =>
        commitSchema(editSchemaField(state.schema, p, { default: parseDefault(v) })),
      ),
    )
  }
  if (row.type === 'number' || row.type === 'integer') {
    cons.appendChild(conInput('min', row.minimum, (v) => commitSchema(editSchemaField(state.schema, p, { minimum: numOrUndef(v) })), 'number'))
    cons.appendChild(conInput('max', row.maximum, (v) => commitSchema(editSchemaField(state.schema, p, { maximum: numOrUndef(v) })), 'number'))
  }
  if (row.type === 'string') {
    cons.appendChild(conInput('minLen', row.minLength, (v) => commitSchema(editSchemaField(state.schema, p, { minLength: numOrUndef(v) })), 'number'))
    cons.appendChild(conInput('maxLen', row.maxLength, (v) => commitSchema(editSchemaField(state.schema, p, { maxLength: numOrUndef(v) })), 'number'))
    cons.appendChild(conInput('pattern', row.pattern, (v) => commitSchema(editSchemaField(state.schema, p, { pattern: strOrUndef(v) }))))
  }
  if (row.type === 'string' || row.type === 'number' || row.type === 'integer') {
    const enumStr = Array.isArray(row.enum) ? row.enum.map((x) => String(x)).join(', ') : ''
    const numeric = row.type !== 'string'
    cons.appendChild(
      conInput('enum (a, b)', enumStr, (v) => {
        const parts = v.split(',').map((s) => s.trim()).filter((s) => s !== '')
        const en = parts.length === 0 ? undefined : numeric ? parts.map(Number) : parts
        commitSchema(editSchemaField(state.schema, p, { enum: en }))
      }),
    )
  }
  cons.appendChild(conInput('description', row.description, (v) => commitSchema(editSchemaField(state.schema, p, { description: strOrUndef(v) }))))
  el.appendChild(cons)
  return el
}

function addFieldControl(): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'schema-add'
  const rows = flattenSchema(state.schema)
  const objectPaths: string[][] = [[], ...rows.filter((r) => r.type === 'object').map((r) => r.path)]
  const parentSel = document.createElement('select')
  for (const path of objectPaths) {
    const o = document.createElement('option')
    o.value = JSON.stringify(path)
    o.textContent = fmtPath(path)
    parentSel.appendChild(o)
  }
  const keyInp = document.createElement('input')
  keyInp.placeholder = 'new key'
  const typeSel = document.createElement('select')
  for (const t of FIELD_TYPES) {
    const o = document.createElement('option')
    o.value = t
    o.textContent = t
    typeSel.appendChild(o)
  }
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '+ Add field'
  btn.addEventListener('click', () => {
    const key = keyInp.value.trim()
    if (key === '') return
    const parent = JSON.parse(parentSel.value) as string[]
    commitSchema(addSchemaField(state.schema, parent, key, typeSel.value))
  })
  wrap.append(parentSel, keyInp, typeSel, btn)
  return wrap
}

function renderSchemaTab(): void {
  if (!isPlainObject(state.schema)) {
    const hint = document.createElement('p')
    hint.className = 'hint'
    hint.textContent = 'No schema yet — load one, or "Generate schema from config".'
    schemaFields.replaceChildren(hint)
    samplePreview.textContent = ''
    return
  }
  const rows = flattenSchema(state.schema)
  const frag = document.createDocumentFragment()
  for (const row of rows) frag.appendChild(schemaFieldRow(row))
  frag.appendChild(addFieldControl())
  schemaFields.replaceChildren(frag)
  samplePreview.textContent = JSON.stringify(sampleFromSchema(state.schema), null, 2)
}

// ---- tabs ----
app.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    app.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    const target = tab.dataset.tab
    app.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
      panel.toggleAttribute('hidden', panel.id !== `panel-${target}`)
    })
    if (target === 'history') renderHistoryTab()
    // Returning to Edit re-syncs its views from the current config.
    if (target === 'edit') {
      if (state.schema !== null) buildForm()
      if (!modeTree.hidden) {
        renderTree()
        renderTreeControls()
      }
    }
  })
})

// ---- file inputs / drop ----
async function openWithFileSystemAccess(kind: 'schema' | 'config'): Promise<void> {
  if (!canUseFileSystemAccess()) {
    status.textContent = 'Direct file save requires a Chromium-based browser with File System Access API support.'
    status.className = 'status error'
    return
  }
  const [handle] = await filePickerWindow.showOpenFilePicker!({
    multiple: false,
    types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
  })
  if (!handle) return
  const file = await handle.getFile()
  const parsed = parseJsonFile(await file.text())
  if (!parsed.ok) {
    status.textContent = parsed.error
    status.className = 'status error'
    return
  }
  markNewData()
  if (kind === 'schema') loadSchema(parsed.value)
  else {
    exitProjectMode() // opening a lone config file leaves project-folder mode
    loadConfigFromHandle(parsed.value, handle)
  }
}

async function readJsonHandle(handle: FileSystemFileHandleLike): Promise<unknown> {
  const file = await handle.getFile()
  const parsed = parseJsonFile(await file.text())
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

// All jigtor artifacts live under `.jigtor/`, read from the SAME path they are
// written to (schema.json plain, history.json.gz gzipped) — the project root
// holds only the user's own config.json.
async function readJigtorSchema(dir: FileSystemDirectoryHandleLike): Promise<unknown | null> {
  try {
    const jigtorDir = await dir.getDirectoryHandle('.jigtor')
    return await readJsonHandle(await jigtorDir.getFileHandle('schema.json'))
  } catch {
    return null
  }
}

async function readJigtorHistory(dir: FileSystemDirectoryHandleLike): Promise<SaveHistory> {
  try {
    const jigtorDir = await dir.getDirectoryHandle('.jigtor')
    const file = await (await jigtorDir.getFileHandle('history.json.gz')).getFile()
    return parseHistory(await gunzip(await file.arrayBuffer()))
  } catch {
    return []
  }
}

// Root-level JSON files, the candidates a user might want to edit. Directories
// (including `.jigtor/`) are skipped so only real config files are offered.
async function listRootJsonFiles(dir: FileSystemDirectoryHandleLike): Promise<string[]> {
  if (typeof dir.values !== 'function') return []
  const names: string[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
      names.push(entry.name)
    }
  }
  return names.sort()
}

// Load the chosen file as the editable config, pulling any sibling .jigtor/
// schema + history. With no schema, recommend generating one from the config.
async function loadProjectConfig(dir: FileSystemDirectoryHandleLike, fileName: string): Promise<void> {
  schemaRecommend.hidden = true
  currentConfigName = fileName
  configFileHandle = await dir.getFileHandle(fileName)
  const schema = await readJigtorSchema(dir)
  history = await readJigtorHistory(dir) // versioned snapshots from .jigtor/history.json.gz
  renderHistoryTab()
  markNewData()
  state.schema = schema
  loadConfigFromHandle(await readJsonHandle(configFileHandle), configFileHandle)
  if (schema === null) recommendGenerateSchema(fileName)
  await renderProjectTree()
}

// Leaving project mode (import / drag-drop / example / single-file open): there
// is no managed folder anymore, so hide the tree and forget the active file.
function exitProjectMode(): void {
  projectDirectoryHandle = null
  currentConfigName = null
  projectPicker.hidden = true
  projectTree.hidden = true
}

// Compact file-explorer view of what jigtor manages in the opened folder: the
// editable config (plus sibling JSON candidates you can switch to) and the
// .jigtor/ artifacts. Enumeration reuses the same values() seam as the picker.
async function renderProjectTree(): Promise<void> {
  const dir = projectDirectoryHandle
  if (dir === null || typeof dir.values !== 'function') {
    projectTree.hidden = true
    return
  }
  const files: string[] = []
  const subdirs: string[] = []
  for await (const entry of dir.values()) {
    ;(entry.kind === 'directory' ? subdirs : files).push(entry.name)
  }
  const jigtorFiles = subdirs.includes('.jigtor') ? await listDirNames(dir, '.jigtor') : []

  projectTreeBody.replaceChildren(
    treeDirNode(dir.name, buildProjectChildren(dir, files.sort(), subdirs.sort(), jigtorFiles.sort())),
  )
  projectTree.hidden = false
  projectTree.open = true
}

async function listDirNames(dir: FileSystemDirectoryHandleLike, name: string): Promise<string[]> {
  try {
    const sub = await dir.getDirectoryHandle(name)
    if (typeof sub.values !== 'function') return []
    const names: string[] = []
    for await (const entry of sub.values()) names.push(entry.name)
    return names
  } catch {
    return []
  }
}

const JIGTOR_ROLES: Record<string, string> = {
  'schema.json': 'schema',
  'history.json.gz': 'history',
}

// Root children: sibling directories (only .jigtor expanded) then files (JSON
// files clickable to switch config; the active one badged, others muted).
function buildProjectChildren(
  dir: FileSystemDirectoryHandleLike,
  files: string[],
  subdirs: string[],
  jigtorFiles: string[],
): HTMLUListElement {
  const ul = document.createElement('ul')
  for (const name of subdirs) {
    const children =
      name === '.jigtor'
        ? treeChildList(jigtorFiles.map((f) => treeFileNode(f, { badge: JIGTOR_ROLES[f], muted: true })))
        : undefined
    ul.appendChild(treeDirNode(name, children))
  }
  for (const name of files) {
    const isJson = name.toLowerCase().endsWith('.json')
    const isActive = name === currentConfigName
    ul.appendChild(
      treeFileNode(name, {
        active: isActive,
        badge: isActive ? 'editing' : undefined,
        muted: !isJson,
        onClick:
          isJson && !isActive
            ? () => void loadProjectConfig(dir, name).catch((e) => {
                status.textContent = `Could not open ${name}: ${String(e)}`
                status.className = 'status error'
              })
            : undefined,
      }),
    )
  }
  return ul
}

function treeChildList(items: HTMLLIElement[]): HTMLUListElement {
  const ul = document.createElement('ul')
  for (const it of items) ul.appendChild(it)
  return ul
}

function treeDirNode(name: string, children?: HTMLUListElement): HTMLLIElement {
  const li = document.createElement('li')
  li.className = 'tree-dir'
  const label = document.createElement('span')
  label.className = 'tree-label'
  label.textContent = `📁 ${name}`
  li.appendChild(label)
  if (children) li.appendChild(children)
  return li
}

function treeFileNode(
  name: string,
  opts: { active?: boolean; badge?: string; muted?: boolean; onClick?: () => void },
): HTMLLIElement {
  const li = document.createElement('li')
  li.className = `tree-file${opts.active ? ' active' : ''}${opts.muted ? ' muted' : ''}`
  let label: HTMLElement
  if (opts.onClick) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'tree-link'
    btn.addEventListener('click', opts.onClick)
    label = btn
  } else {
    label = document.createElement('span')
    label.className = 'tree-label'
  }
  label.textContent = `📄 ${name}`
  li.appendChild(label)
  if (opts.badge) {
    const badge = document.createElement('span')
    badge.className = 'tree-badge'
    badge.textContent = opts.badge
    li.appendChild(badge)
  }
  return li
}

// More than one JSON in the folder: ask which is the config, pre-highlighting
// config.json when present.
function renderConfigCandidatePicker(dir: FileSystemDirectoryHandleLike, candidates: string[]): void {
  const preferred = candidates.includes('config.json') ? 'config.json' : candidates[0]
  projectPicker.innerHTML = ''
  const label = document.createElement('span')
  label.className = 'hint'
  label.textContent = 'Which file is the config to edit?'
  projectPicker.appendChild(label)
  for (const name of candidates) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = name === preferred ? 'filebtn primary' : 'filebtn'
    btn.textContent = name
    btn.addEventListener('click', () => {
      projectPicker.hidden = true
      void loadProjectConfig(dir, name).catch((e) => {
        configFileHandle = null
        status.textContent = `Could not open ${name}: ${String(e)}`
        status.className = 'status error'
      })
    })
    projectPicker.appendChild(btn)
  }
  projectPicker.hidden = false
}

async function openProjectFolder(): Promise<void> {
  if (typeof filePickerWindow.showDirectoryPicker !== 'function') {
    status.textContent = 'Project-folder save requires a Chromium-based browser with directory access support.'
    status.className = 'status error'
    return
  }
  projectPicker.hidden = true
  const dir = await filePickerWindow.showDirectoryPicker()
  projectDirectoryHandle = dir
  const candidates = await listRootJsonFiles(dir)
  const [first] = candidates
  if (first === undefined) {
    projectDirectoryHandle = null
    status.textContent = 'No .json files in this folder. Add a config.json, or use "Other sources" to import one.'
    status.className = 'status error'
    return
  }
  if (candidates.length === 1) {
    await loadProjectConfig(dir, first)
    return
  }
  renderConfigCandidatePicker(dir, candidates)
}

openProjectBtn.addEventListener('click', () => {
  void openProjectFolder().catch((e) => {
    projectDirectoryHandle = null
    configFileHandle = null
    status.textContent = `Could not open project folder: ${String(e)}`
    status.className = 'status error'
  })
})
openSchemaBtn.addEventListener('click', () => {
  void openWithFileSystemAccess('schema').catch((e) => {
    status.textContent = `Could not open schema: ${String(e)}`
    status.className = 'status error'
  })
})
openConfigBtn.addEventListener('click', () => {
  void openWithFileSystemAccess('config').catch((e) => {
    status.textContent = `Could not open config: ${String(e)}`
    status.className = 'status error'
  })
})

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
function generateSchemaFromConfig(): boolean {
  if (typeof state.config !== 'object' || state.config === null || Array.isArray(state.config)) {
    status.textContent = 'Load an object config first to generate a schema.'
    status.className = 'status error'
    return false
  }
  loadSchema(inferSchema(state.config))
  schemaMsg.textContent = 'generated from config — adjust as needed'
  ;(app.querySelector('.tab[data-tab="schema"]') as HTMLButtonElement).click()
  return true
}

// Shown after opening a config that has no .jigtor/schema.json: without a schema
// there are no typed controls, so generating one is the recommended next step.
function recommendGenerateSchema(fileName: string): void {
  status.textContent = `Loaded ${fileName}. No schema found for this project.`
  status.className = 'status'
  projectPicker.hidden = true
  schemaRecommend.innerHTML = ''
  const msg = document.createElement('span')
  msg.textContent = 'No schema yet — generate one from your config to get typed, validated fields.'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'filebtn primary'
  btn.textContent = 'Generate schema from config'
  btn.addEventListener('click', () => {
    if (generateSchemaFromConfig()) schemaRecommend.hidden = true
  })
  schemaRecommend.append(msg, btn)
  schemaRecommend.hidden = false
}

app.querySelector<HTMLButtonElement>('#infer-schema')!.addEventListener('click', () => {
  generateSchemaFromConfig()
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
  const s = parseJsonFile(exampleSchemaText)
  const c = parseJsonFile(exampleConfigText)
  if (!s.ok || !c.ok) {
    status.textContent = 'Could not load bundled example.'
    status.className = 'status error'
    return
  }
  state.schema = s.value
  state.config = c.value
  markNewData() // fresh session -> re-baseline
  exitProjectMode() // the bundled example isn't a real folder
  buildForm()
})

// ---- save: review diff, then write config.json (allowed even when invalid) ----
function download(): void {
  const blob = new Blob([serializeConfig(state.config)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'config.json'
  a.click()
  URL.revokeObjectURL(url)
}

async function ensureWritablePermission(handle: FileSystemFileHandleLike): Promise<boolean> {
  const options = { mode: 'readwrite' as const }
  if ((await handle.queryPermission?.(options)) === 'granted') return true
  if ((await handle.requestPermission?.(options)) === 'granted') return true
  return handle.queryPermission === undefined && handle.requestPermission === undefined
}

async function writeFileHandle(
  handle: FileSystemFileHandleLike,
  data: string | BufferSource | Blob,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

// gzip via the browser Compression Streams API (keeps the versioned history small).
async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).blob()
}
async function gunzip(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

// Persist jigtor artifacts under `.jigtor/` (same paths readJigtor* read from):
// the current schema (only when one exists) and the gzipped version history.
async function writeProjectMetadata(): Promise<void> {
  if (projectDirectoryHandle === null) return
  const jigtorDir = await projectDirectoryHandle.getDirectoryHandle('.jigtor', { create: true })
  if (state.schema !== null) {
    await writeFileHandle(
      await jigtorDir.getFileHandle('schema.json', { create: true }),
      serializeConfig(state.schema),
    )
  }
  await writeFileHandle(
    await jigtorDir.getFileHandle('history.json.gz', { create: true }),
    await gzip(JSON.stringify(history)),
  )
}

async function saveConfig(): Promise<'direct' | 'download'> {
  // Keep the original file's key order on disk (new keys appended), independent
  // of how the value was edited. state.original holds the loaded/last-saved order.
  state.config = orderLike(state.config, state.original)
  if (configFileHandle !== null && canUseFileSystemAccess()) {
    if (!(await ensureWritablePermission(configFileHandle))) {
      throw new Error('write permission was not granted')
    }
    await writeFileHandle(configFileHandle, serializeConfig(state.config))
    return 'direct'
  }
  download()
  return 'download'
}

async function reconnectConfigFileForSave(): Promise<boolean> {
  if (!canUseFileSystemAccess()) return false
  const [handle] = await filePickerWindow.showOpenFilePicker!({
    multiple: false,
    types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
  })
  if (!handle) return false

  const target = prepareConfigReconnect(state.config, await (await handle.getFile()).text())
  if (!target.ok) throw new Error(`selected file is not valid JSON: ${target.error}`)

  // Keep every restored/in-session edit. Only the target handle and diff
  // baseline change here; no bytes are written until the next explicit click.
  configFileHandle = handle
  exitProjectMode()
  state.config = target.config
  state.original = clone(target.baseline)
  baselineEstablished = true

  if (state.schema !== null && currentForm !== null) revalidate()
  else {
    persist()
    updateDirty()
    renderConfigPreview()
  }
  renderTree()
  renderTreeControls()
  status.textContent = `Connected ${handle.name}. Review the on-disk diff before saving.`
  status.className = 'status ok'
  return true
}

function markSaved(): void {
  // spec:history (REQ-H01): append a full-config snapshot of this saved version,
  // then advance the baseline.
  history = recordSnapshot(history, state.config, Date.now())
  persistHistory()
  renderHistoryTab()
  state.original = clone(state.config) // new baseline after a save
  saveDialog.hidden = true
  updateDirty()
  revalidate() // clear per-field dirty decoration now that everything is saved
}

function renderSaveDialog(): void {
  const changes = diffConfig(state.original, state.config)
  const result = state.schema !== null ? validateConfig(state.schema, state.config) : null

  saveDialog.replaceChildren()
  const title = document.createElement('h3')
  title.textContent = 'Review changes'
  saveDialog.appendChild(title)

  if (result && !result.valid) {
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
    // Review changes as the JSON body itself (whole-file diff), not a change list.
    const diff = document.createElement('pre')
    diff.className = 'save-diff'
    fillWholeFileDiff(diff)
    saveDialog.appendChild(diff)
  }

  const actions = document.createElement('div')
  actions.className = 'schema-actions'
  const saveAction = document.createElement('button')
  saveAction.type = 'button'
  if (configFileHandle === null && canUseFileSystemAccess()) {
    const reconnectHint = document.createElement('p')
    reconnectHint.className = 'hint'
    reconnectHint.textContent =
      'This restored or imported session has no save target. Connect a JSON file without discarding your current edits.'
    saveDialog.appendChild(reconnectHint)
    saveAction.textContent = 'Connect config.json…'
    saveAction.addEventListener('click', () => {
      saveAction.disabled = true
      void reconnectConfigFileForSave()
        .then((connected) => {
          if (connected) renderSaveDialog()
          else saveAction.disabled = false
        })
        .catch((e) => {
          saveAction.disabled = false
          status.textContent = `Could not connect config.json: ${String(e)}`
          status.className = 'status error'
        })
    })
  } else {
    saveAction.textContent = configFileHandle
      ? `Save ${configFileHandle.name}`
      : 'Download config.json'
    saveAction.addEventListener('click', () => {
      void saveConfig()
        .then(async (mode) => {
          markSaved()
          await writeProjectMetadata()
          await renderProjectTree() // .jigtor/ artifacts may have just been created
          status.textContent = mode === 'direct' ? 'Saved config.json.' : 'Downloaded config.json.'
          status.className = 'status ok'
        })
        .catch((e) => {
          status.textContent = `Could not save config.json: ${String(e)}`
          status.className = 'status error'
        })
    })
  }
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => (saveDialog.hidden = true))
  actions.append(saveAction, cancel)
  saveDialog.appendChild(actions)
  saveDialog.hidden = false
}

app.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => {
  renderSaveDialog()
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

// Prompt before leaving with unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})

// ---- startup: restore the last session if present ----
const restored = restoreSaved()
buildForm()
renderHistoryTab() // show persisted save history from previous sessions
if (restored) {
  forgetBtn.hidden = false
  status.textContent = 'Restored your last session — load a file to start fresh.'
  status.className = 'status'
}
