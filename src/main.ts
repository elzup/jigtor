// UI shell: loading, tabbed views (Edit | Schema), in-place live validation,
// schema inference/adjustment, default seeding, diff-confirmed save.
// All schema/validate/render/infer/defaults/diff logic lives in ./core (tested).
import './style.css'
import { useUiStore, type Tab } from './ui/store'
import { parseSchema } from './core/parseSchema'
import { validateConfig } from './core/validateConfig'
import {
  parseJsonFile,
  serializeConfig,
  prepareProjectReconnect,
  resolveSaveTargetMode,
} from './core/fileIo'
import { renderForm, refreshErrors, refreshFieldMeta } from './core/renderForm'
import { inferSchema } from './core/inferSchema'
import { applyDefaults } from './core/applyDefaults'
import { diffConfig } from './core/diffConfig'
import { lineDiff } from './core/lineDiff'
import {
  valueType,
  defaultForType,
  jsonGet,
  jsonSet,
  jsonDelete,
  jsonRenameKey,
  jsonInsert,
  jsonMoveItem,
  jsonMoveKey,
  type JsonPath,
  type JsonType,
} from './core/jsonEdit'
import { resolveSchemaAt, resolveRawSchemaAt } from './core/schemaAt'
import { orderedChildSlots, keyOrderMatchesSchema } from './core/treeOverlay'
import { orderLike } from './core/orderLike'
import {
  recordSnapshot,
  fieldHistory,
  historyPaths,
  parseHistory,
  mergeHistories,
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
import { installTauriFileSystem } from './tauri-fs'

// When running inside the Tauri desktop shell, back the File System Access seam
// with native Rust fs; a no-op in browsers, so this same module drives both.
installTauriFileSystem()

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const

type State = {
  schema: unknown | null
  config: unknown
  original: unknown
  originalSchema: unknown | null
  // Key order the user intends, captured at load and updated on save (NOT on a
  // reconnect re-read). Used to tell an intentional ↑↓ move (persist + show in
  // diff) from an incidental on-disk order difference after reconnect (hide).
  canonical: unknown
}
const state: State = { schema: null, config: {}, original: {}, originalSchema: null, canonical: {} }

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
let hasConfirmedDownloadMode = false
let hasLoadedConfig = false
let currentConfigName: string | null = null // which file the project tree marks as "editing"
const filePickerWindow = window as FilePickerWindow
const canUseProjectAccess = (): boolean =>
  typeof filePickerWindow.showDirectoryPicker === 'function'

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
    state.originalSchema = clone(saved.schema)
    state.config = saved.config ?? {}
    hasLoadedConfig = true
    markNewData()
    return true
  } catch {
    return false
  }
}

// Strangler migration: the whole imperative shell is now mounted by React into a
// container it owns (src/main.tsx). Everything below is unchanged behaviour; it is
// carved into JSX components incrementally while e2e stays green.
export function mountLegacyApp(app: HTMLDivElement): void {

// Flat line icons (Feather / react-icons "Fi" style) — inline SVG, currentColor,
// so they inherit text color/size. Static markup only (no user input).
const ICON = {
  folder:
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  switch:
    '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  alert:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  wand: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  layout:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  branch:
    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  reset:
    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
} as const

const svgMarkup = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="jt-icon" aria-hidden="true">${inner}</svg>`

function svgIcon(inner: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'jt-icon',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(k, v)
  }
  svg.innerHTML = inner
  return svg
}

app.innerHTML = `
  <div class="file-bar">
    <section id="drop" class="drop">
      <div class="drop-primary">
        <button id="open-project" class="filebtn primary" type="button">${svgMarkup(ICON.folder)} Open project folder</button>
      </div>
    </section>
    <div class="drop-manage" id="manage">
      <div id="project-picker" class="project-picker" hidden></div>
      <section id="reconnect-gate" class="reconnect-gate" aria-labelledby="reconnect-gate-title" hidden>
        <div class="reconnect-title">
          <span class="reconnect-icon" aria-hidden="true">${svgMarkup(ICON.folder)}</span>
          <h2 id="reconnect-gate-title">Reconnect project</h2>
        </div>
        <p>Reconnect the original folder to keep config.json and .jigtor files in sync.</p>
        <p class="hint">Choose the same project folder. Nothing is written until Save.</p>
        <p id="reconnect-gate-status" class="status error" hidden></p>
        <div class="schema-actions">
          <button id="reconnect-gate-action" class="filebtn primary" type="button">${svgMarkup(ICON.folder)} Reconnect project folder…</button>
          <button id="download-mode-action" type="button">${svgMarkup(ICON.switch)} Use Download mode</button>
        </div>
      </section>
      <aside id="connection-alert" class="connection-alert" role="status" hidden>
        <span class="connection-icon" aria-hidden="true">${svgMarkup(ICON.alert)}</span>
        <span><strong>Not connected</strong> — Download mode. Project history is unavailable.</span>
        <button id="connection-reconnect" class="filebtn" type="button">${svgMarkup(ICON.folder)} Reconnect project…</button>
      </aside>
      <details id="project-tree" class="project-tree-view" hidden>
        <summary>Project files</summary>
        <div id="project-tree-body"></div>
      </details>
    </div>
  </div>

  <div id="tabs-slot"></div>

  <section id="panel-edit" class="panel">
    <p id="status" class="status"></p>
    <div id="schema-recommend" class="recommend" hidden></div>
    <div class="edit-mode-bar">
      <div class="mode-switch" role="tablist">
        <button id="mode-block-btn" class="mode" data-mode="block" type="button">${svgMarkup(ICON.layout)} Block</button>
        <button id="mode-tree-btn" class="mode active" data-mode="tree" type="button">${svgMarkup(ICON.branch)} Tree</button>
      </div>
      <span class="undo-redo">
        <button id="undo" class="filebtn" type="button" title="Undo (Ctrl/Cmd+Z)" disabled>${svgMarkup(ICON.undo)} Undo</button>
        <button id="redo" class="filebtn" type="button" title="Redo (Ctrl/Cmd+Shift+Z)" disabled>${svgMarkup(ICON.redo)} Redo</button>
      </span>
      <label class="compact-toggle"><input type="checkbox" id="compact-mode"> Compact fields</label>
    </div>
    <div id="mode-block" hidden>
      <main id="form-host"></main>
    </div>
    <div id="mode-tree">
      <p class="hint">Direct JSON editing — no schema needed. Edit values, change
        types, rename keys, add / remove / reorder.</p>
      <div id="tree-host" class="tree-edit"></div>
    </div>
    <div class="diff-cols">
      <div id="config-json" class="config-json">
        <div class="diff-label">Live diff — whole file (vs last load / save)</div>
        <pre id="config-preview"></pre>
      </div>
      <aside id="tree-controls" class="tree-controls" hidden></aside>
    </div>
    <footer class="save-bar">
      <button id="save" type="button">${svgMarkup(ICON.save)} Review &amp; save…</button>
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
const panelEdit = app.querySelector<HTMLElement>('#panel-edit')!
const reconnectGate = app.querySelector<HTMLElement>('#reconnect-gate')!
const reconnectGateStatus = app.querySelector<HTMLParagraphElement>('#reconnect-gate-status')!
const reconnectGateAction = app.querySelector<HTMLButtonElement>('#reconnect-gate-action')!
const downloadModeAction = app.querySelector<HTMLButtonElement>('#download-mode-action')!
const connectionAlert = app.querySelector<HTMLElement>('#connection-alert')!
const connectionReconnect = app.querySelector<HTMLButtonElement>('#connection-reconnect')!
const formHost = app.querySelector<HTMLElement>('#form-host')!
const schemaEditor = app.querySelector<HTMLTextAreaElement>('#schema-editor')!
const schemaMsg = app.querySelector<HTMLSpanElement>('#schema-msg')!
const saveDialog = app.querySelector<HTMLDivElement>('#save-dialog')!
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
const compactToggleLabel = app.querySelector<HTMLLabelElement>('.compact-toggle')!

function setReconnectGate(isOpen: boolean): void {
  reconnectGate.hidden = !isOpen
  panelEdit.classList.toggle('restore-gated', isOpen)
  for (const child of Array.from(panelEdit.children)) {
    if (child !== reconnectGate && child instanceof HTMLElement) child.inert = isOpen
  }
  if (isOpen) (reconnectGateAction.disabled ? downloadModeAction : reconnectGateAction).focus()
  updateConnectionAlert()
}

function updateConnectionAlert(): void {
  connectionAlert.hidden = !hasLoadedConfig || projectDirectoryHandle !== null || !reconnectGate.hidden
}

const saveTargetMode = () =>
  resolveSaveTargetMode(
    projectDirectoryHandle !== null && configFileHandle !== null,
    canUseProjectAccess(),
    hasConfirmedDownloadMode,
  )

// Edit tab has two views of the same config: Block (schema-driven form) and Tree
// (schema-independent JSON editor). Switching to Block re-syncs the form from the
// current config; switching to Tree renders the editor + the controls panel.
function setEditMode(mode: 'block' | 'tree'): void {
  modeBlock.hidden = mode !== 'block'
  modeTree.hidden = mode !== 'tree'
  treeControls.hidden = mode !== 'tree' // the controls panel sits beside the Live diff
  compactToggleLabel.hidden = mode === 'tree' // "Compact fields" only applies to the Block form
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

// "Open project folder" is the single entry point (user request: no drag-drop,
// no import/other-source buttons). Where the directory-picker API is missing
// (Safari/Firefox), there is nothing to fall back to — hide it.
if (!canUseProjectAccess()) openProjectBtn.hidden = true

// Dirty includes both config changes and schema edits such as field removal.
let isDirty = false
function updateDirty(): void {
  const configCount = diffConfig(state.original, state.config).length
  const schemaCount = JSON.stringify(state.originalSchema) === JSON.stringify(state.schema) ? 0 : 1
  const count = configCount + schemaCount
  isDirty = count > 0
  const label = isDirty ? `Review & save… (${count})` : 'Review & save…'
  saveBtn.replaceChildren(svgIcon(ICON.save), document.createTextNode(label))
  saveBtn.classList.toggle('dirty', isDirty)
  dirtyNote.hidden = !isDirty
  dirtyNote.textContent = isDirty ? `${count} unsaved change(s) — not saved yet` : ''
}

// Live whole-file diff of the config as it is edited (user request): the entire
// file is shown, with every line since the loaded/saved baseline marked as
// added / removed / unchanged so pending edits are visible in place before save.
function fillWholeFileDiff(target: HTMLElement): void {
  // The config (after) is shown in its OWN key order so an intentional ↑↓ move
  // is visible in the diff and will be saved. The baseline (before) is realigned
  // to the canonical (load/save-time) order, so an incidental on-disk order
  // difference after a project reconnect does NOT show as spurious add/remove
  // lines — only order changes the user actually made appear.
  const before = (JSON.stringify(orderLike(state.original, state.canonical), null, 2) ?? 'null').split('\n')
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
  syncTabs() // load state may have changed which tabs are meaningful
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
    state.canonical = clone(state.config) // load-time key order is the canonical order
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
  revalidate()
}

// ---- Tree (real edit) mode: schema-independent, Firestore-style JSON editor ----
const collapsedPaths = new Set<string>() // pathKey -> collapsed (default expanded)
const addingPaths = new Set<string>() // pathKey -> the object's "new key" input is revealed
const pathKey = (path: JsonPath): string => JSON.stringify(path)
// A path key that matches validateConfig's string[] paths (array indices come
// back as strings there, but as numbers in a JsonPath), so Tree leaves can look
// up their own validation message.
const errKey = (path: JsonPath): string => path.map(String).join('')
let treeErrors: Map<string, string> = new Map()

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
  treeErrors = collectTreeErrors()
  const type = valueType(state.config)
  if (type === 'object' || type === 'array') {
    treeHost.replaceChildren(treeContainerBody(state.config, []))
  } else {
    // A bare primitive root: offer a single value editor at the root path.
    treeHost.replaceChildren(treeLeafRow('(value)', state.config, [], { root: true }))
  }
  sizeTreeZones()
}

// Map each schema-invalid path to its message so Tree leaves can flag themselves.
// The Block form has its own error wiring (revalidate); the Tree validates here
// independently so a red field + message shows even when the form isn't built.
function collectTreeErrors(): Map<string, string> {
  const map = new Map<string, string>()
  if (state.schema === null) return map
  for (const err of validateConfig(state.schema, state.config).errors) {
    if (err.path.length > 0) map.set(errKey(err.path), err.message)
  }
  return map
}

// Lock the content zone to its widest row so the action rail lines up in one
// vertical column with no wasted width. Measured after render (no absolute
// layout); scrollWidth is 0 without real layout (jsdom), so we keep max-content.
function sizeTreeZones(): void {
  treeHost.style.setProperty('--zc', 'max-content')
  let max = 0
  treeHost.querySelectorAll<HTMLElement>('.jt-zc').forEach((zc) => {
    max = Math.max(max, zc.scrollWidth)
  })
  if (max > 0) treeHost.style.setProperty('--zc', `${max + 4}px`)
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
  if (leaves.length === 0) {
    treeControls.replaceChildren(metaSpan('No fields yet.', 'hint'))
    return
  }
  const table = document.createElement('table')
  table.className = 'tc-table'
  const tbody = document.createElement('tbody')
  for (const [path, value] of leaves) {
    const tr = document.createElement('tr')
    const th = document.createElement('th')
    th.className = 'tc-label'
    th.scope = 'row'
    th.textContent = dotPath(path)
    const td = document.createElement('td')
    td.className = 'tc-cell'
    td.appendChild(treeControl(path, value))
    tr.append(th, td)
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  treeControls.replaceChildren(table)
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
    box.className = 'tc-toggle toggle'
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
  if (Array.isArray(container)) {
    // Arrays are positional: element order is data, never overlaid or reordered.
    container.forEach((value, i) => wrap.appendChild(treeEntry(i, value, path, true)))
    wrap.appendChild(treeAddRow(container, path))
    return wrap
  }
  const obj = container as Record<string, unknown>
  const schemaNode = state.schema !== null ? resolveRawSchemaAt(state.schema, path) : null
  const schemaProps = objectSchemaKeys(schemaNode)
  for (const slot of orderedChildSlots(Object.keys(obj), schemaProps)) {
    if (slot.presence === 'missing') {
      wrap.appendChild(treeMissingRow(slot.key, path, childSchemaOf(schemaNode, slot.key)))
    } else {
      wrap.appendChild(treeEntry(slot.key, obj[slot.key], path, false))
    }
  }
  // The "new key" input is revealed on demand from the parent's + button (see
  // treeAddKeyToggle). The root object has no header row to host that button, so
  // its add-row stays always visible.
  if (path.length === 0 || addingPaths.has(pathKey(path))) {
    wrap.appendChild(treeAddRow(container, path))
  }
  return wrap
}

const isSchemaObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Property keys declared by an object schema node, in declared order — or null
// when the node doesn't describe an object (so the caller keeps config order).
function objectSchemaKeys(node: Record<string, unknown> | null): string[] | null {
  if (node === null || !isSchemaObject(node.properties)) return null
  return Object.keys(node.properties)
}

function childSchemaOf(node: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (node === null || !isSchemaObject(node.properties)) return null
  const child = node.properties[key]
  return isSchemaObject(child) ? child : null
}

const SCHEMA_TO_JSON_TYPE: Record<string, JsonType> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
  null: 'null',
}

function missingKeyType(childSchema: Record<string, unknown> | null): JsonType | null {
  const t = childSchema?.type
  return typeof t === 'string' && t in SCHEMA_TO_JSON_TYPE ? SCHEMA_TO_JSON_TYPE[t]! : null
}

// A schema-declared key that the config file does not have: shown greyed so the
// user can see what the schema expects, with an "add" action that inserts the
// schema default (or the type's default) at the right slot.
function treeMissingRow(
  key: string,
  parentPath: JsonPath,
  childSchema: Record<string, unknown> | null,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'jt-row jt-missing'
  row.style.setProperty('--depth', String(parentPath.length))
  const zc = document.createElement('span')
  zc.className = 'jt-zc'
  zc.append(spacer()) // lead slot, matching editable rows
  zc.append(metaSpan(key, 'jt-mkey'))
  const jt = missingKeyType(childSchema)
  if (jt !== null) zc.append(treeTypeChip(defaultForType(jt)))
  zc.append(metaSpan('not set', 'jt-missing-tag'))
  if (typeof childSchema?.description === 'string') zc.title = childSchema.description
  zc.append(
    svgIconButton(
      ICON.plus,
      `add ${key}`,
      () => {
        const value = childSchema && 'default' in childSchema ? childSchema.default : defaultForType(jt ?? 'string')
        applyTreeEdit(jsonInsert(state.config, parentPath, key, value))
      },
      ' add',
    ),
  )
  row.append(zc)
  return row
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

// Object/array node: a header row (content zone + action rail) + collapsible
// children. The disclosure toggle is the row's lead glyph.
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
  header.style.setProperty('--depth', String(Math.max(0, path.length - 1)))
  const collapsed = collapsedPaths.has(pathKey(path))
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = `jt-toggle${collapsed ? '' : ' open'}`
  toggle.setAttribute('aria-label', collapsed ? 'expand' : 'collapse')
  toggle.appendChild(svgIcon(collapsed ? ICON.chevronRight : ICON.down))
  toggle.addEventListener('click', () => {
    if (collapsed) collapsedPaths.delete(pathKey(path))
    else collapsedPaths.add(pathKey(path))
    renderTree()
  })
  const lead = metaSpan('', 'jt-lead')
  lead.appendChild(toggle)
  const zc = treeContentZone(key, value, path, { inArray, lead, hasError: false })
  // Object headers carry the "+ key" reveal button to the right of the key, so a
  // new-key input appears (indented) only on demand instead of a permanent row.
  if (!Array.isArray(value)) zc.append(treeAddKeyToggle(path))
  header.append(zc)
  header.append(treeRail(path, value, { panel: null, entries: [] }))
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
  const hasError = treeErrors.has(errKey(path))
  const row = document.createElement('div')
  row.className = 'jt-row'
  const lead = spacer() // a leaf has no disclosure toggle, but keeps the lead slot
  row.append(treeContentZone(key, value, path, { inArray: opts.inArray ?? false, lead, hasError, root: opts.root }))
  if (opts.root) return row
  row.style.setProperty('--depth', String(Math.max(0, path.length - 1)))

  // The lazy history panel (built hidden; rows filled on first reveal) drops below
  // the row, as does any validation message. Its rail button toggles the panel.
  const entries = fieldHistory(history, path.map(String))
  const panel = buildHistoryPanel(entries, path)
  row.append(treeRail(path, value, { panel, entries }))

  if (!hasError && panel === null) return row
  const leaf = document.createElement('div')
  leaf.className = 'jt-leaf'
  leaf.style.setProperty('--depth', String(Math.max(0, path.length - 1))) // errrow/panel inherit
  leaf.append(row)
  if (hasError) leaf.append(treeErrorRow(path, treeErrors.get(errKey(path)) ?? ''))
  if (panel) leaf.append(panel)
  return leaf
}

// The merged content zone: everything except the action rail, on one
// left-aligned line — lead (toggle/spacer), key, type chip, the basic form field
// (or child count), the rich widget, the "not in schema" badge, and array ↑↓.
function treeContentZone(
  key: string | number,
  value: unknown,
  path: JsonPath,
  opts: { inArray: boolean; lead: HTMLElement; hasError: boolean; root?: boolean },
): HTMLElement {
  const zc = document.createElement('span')
  zc.className = 'jt-zc'
  const type = valueType(value)
  const isContainer = type === 'object' || type === 'array'
  zc.append(opts.lead)
  if (!opts.root) zc.append(treeKeyCell(key, path, opts.inArray))
  zc.append(treeTypeChip(value))
  if (isContainer) {
    const count = Array.isArray(value) ? value.length : Object.keys(value as object).length
    zc.append(metaSpan(Array.isArray(value) ? `[${count}]` : `{${count}}`, 'jt-count'))
    const orderWarn = schemaOrderBadge(value, path)
    if (orderWarn) zc.append(orderWarn)
  } else {
    zc.append(treeBasicValue(value, path, opts.hasError))
    const rich = treeRichValue(value, path)
    if (rich) zc.append(rich)
  }
  const ext = schemaExtBadge(path, opts.inArray)
  if (ext) zc.append(ext)
  // Changed-since-baseline marker. Containers get it when their subtree differs;
  // leaves get it when their own value differs — so the change is visible ON the
  // field that changed, not only on its ancestor object (which was the only thing
  // marked before, making it impossible to tell WHICH leaf changed).
  if (JSON.stringify(jsonGet(state.original, path)) !== JSON.stringify(value)) {
    const dot = metaSpan('●', 'jt-dot')
    dot.title = isContainer ? 'subtree changed since last save' : 'changed since last save'
    zc.append(dot)
  }
  // Reorder controls live here (position, not editing). Array items move by
  // index; object keys move among their siblings within the SAME parent only.
  if (opts.inArray) zc.append(treeMove(path))
  else if (!opts.root && path.length > 0) zc.append(treeMoveKey(path))
  return zc
}

// Fixed-slot action rail: reset (col 1) · history (col 2) · delete (col 3). Each
// action owns a column so the same button sits in the same vertical line on every
// row; a missing action simply leaves its slot empty.
function treeRail(
  path: JsonPath,
  value: unknown,
  opts: { panel: HTMLElement | null; entries: ReturnType<typeof fieldHistory> },
): HTMLElement {
  const rail = document.createElement('span')
  rail.className = 'jt-z3'
  const reset = treeChangedMeta(path, value) // reset-to-baseline button, when dirty
  if (reset) rail.append(reset)
  if (opts.panel) {
    const panel = opts.panel
    const hist = svgIconButton(ICON.clock, 'field history', () => {
      panel.hidden = !panel.hidden
      if (!panel.hidden) panel.dispatchEvent(new CustomEvent('jt-reveal'))
    })
    hist.classList.add('jt-hist')
    rail.append(hist)
  }
  const del = svgIconButton(ICON.x, 'delete', () => applyTreeEdit(jsonDelete(state.config, path)))
  del.classList.add('jt-del')
  rail.append(del)
  return rail
}

// The array-item reorder pair (↑↓), placed in the content zone.
function treeMove(path: JsonPath): HTMLElement {
  const index = Number(path[path.length - 1])
  const arrayPath = path.slice(0, -1)
  const move = metaSpan('', 'jt-move')
  const up = svgIconButton(ICON.up, 'move up', () => applyTreeEdit(jsonMoveItem(state.config, arrayPath, index, -1)))
  const down = svgIconButton(ICON.down, 'move down', () => applyTreeEdit(jsonMoveItem(state.config, arrayPath, index, 1)))
  up.classList.add('jt-mv')
  down.classList.add('jt-mv')
  move.append(up, down)
  return move
}

// Object-key reorder: swap the key with its previous/next sibling within the
// same parent object. Never crosses into a nested object or up a level.
function treeMoveKey(path: JsonPath): HTMLElement {
  const key = String(path[path.length - 1])
  const parentPath = path.slice(0, -1)
  const move = metaSpan('', 'jt-move')
  const up = svgIconButton(ICON.up, 'move up', () => applyTreeEdit(jsonMoveKey(state.config, parentPath, key, -1)))
  const down = svgIconButton(ICON.down, 'move down', () => applyTreeEdit(jsonMoveKey(state.config, parentPath, key, 1)))
  up.classList.add('jt-mv')
  down.classList.add('jt-mv')
  move.append(up, down)
  return move
}

// Per-field save history, rendered lazily the first time its rail button opens
// the panel. Returns the (hidden) panel element, or null when there is no history.
function buildHistoryPanel(
  entries: ReturnType<typeof fieldHistory>,
  path: JsonPath,
): HTMLElement | null {
  if (entries.length === 0) return null
  const panel = document.createElement('div')
  panel.className = 'jt-history'
  panel.hidden = true
  let populated = false
  panel.addEventListener('jt-reveal', () => {
    if (populated) return
    for (const e of entries) panel.appendChild(treeHistoryRow(e.at, e.after, path))
    populated = true
  })
  return panel
}

// A validation message row, indented under its field (danger-colored, alert icon).
function treeErrorRow(path: JsonPath, message: string): HTMLElement {
  const er = document.createElement('div')
  er.className = 'jt-errrow'
  er.style.setProperty('--depth', String(Math.max(0, path.length - 1)))
  const msg = document.createElement('span')
  msg.className = 'jt-errmsg'
  msg.append(svgIcon(ICON.alert), document.createTextNode(message))
  er.append(msg)
  return er
}

// When a schema is loaded, flag keys it does not define. Such keys stay fully
// editable in Tree mode — this is only a heads-up that the schema won't validate
// them. Only the top-most external key is badged (its whole subtree is external),
// and array items are skipped to avoid per-element noise.
function schemaExtBadge(path: JsonPath, inArray: boolean): HTMLElement | null {
  if (state.schema === null || path.length === 0 || inArray) return null
  if (resolveSchemaAt(state.schema, path) !== null) return null
  const parent = path.slice(0, -1)
  const parentGoverned = parent.length === 0 || resolveSchemaAt(state.schema, parent) !== null
  if (!parentGoverned) return null // an ancestor is already flagged
  const badge = metaSpan('not in schema', 'jt-schema-ext')
  badge.title = 'Not defined in the schema — editable, but the schema does not validate this key.'
  return badge
}

// Soft hint when an object's schema-known keys are not in the schema's declared
// order. File order stays valid — this only nudges toward the recommended order,
// which the user can reach with the ↑↓ move buttons.
function schemaOrderBadge(value: unknown, path: JsonPath): HTMLElement | null {
  if (state.schema === null || Array.isArray(value) || typeof value !== 'object' || value === null) {
    return null
  }
  const schemaKeys = objectSchemaKeys(resolveRawSchemaAt(state.schema, path))
  if (schemaKeys === null || keyOrderMatchesSchema(Object.keys(value), schemaKeys)) return null
  const badge = metaSpan('order ≠ schema', 'jt-order-warn')
  badge.title = 'Key order differs from the schema’s recommended order. Use ↑↓ to reorder.'
  return badge
}

// Reset-to-baseline button, shown only when the leaf differs from the
// loaded/saved baseline (state.original). The previous value is not shown inline
// (that's history — reachable via the clock button); it's in the reset tooltip.
function treeChangedMeta(path: JsonPath, current: unknown): HTMLElement | null {
  const base = jsonGet(state.original, path)
  if (JSON.stringify(base) === JSON.stringify(current)) return null
  const reset = svgIconButton(
    ICON.reset,
    base === undefined ? 'remove (added since last save)' : `reset to ${JSON.stringify(base)}`,
    () => applyTreeEdit(base === undefined ? jsonDelete(state.config, path) : jsonSet(state.config, path, base)),
  )
  reset.classList.add('jt-reset', 'jt-changed')
  return reset
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

// Short glyph per JSON type — a scannable, color-coded hint next to the type
// picker (native <select> options can't carry SVG, so the color lives on a chip).
const TYPE_SYMBOL: Record<string, string> = {
  string: '"',
  number: '#',
  integer: '#',
  boolean: '◑',
  object: '{}',
  array: '[]',
  null: '∅',
}

// Type indicator: the color-coded symbol chip only. Tree mode does not change a
// value's type (that belongs to the schema / Block form), so there is no picker.
function treeTypeChip(value: unknown): HTMLElement {
  const type = valueType(value)
  const chip = document.createElement('span')
  chip.className = 'jt-type-chip'
  chip.dataset.type = type
  chip.textContent = TYPE_SYMBOL[type] ?? '?'
  return chip
}

// Basic form field, on the same line as the key: text · number · boolean-as-text
// · null. Number and enum stay compact; a plain string gets a wide field. Commits
// on change (blur/enter) to avoid caret jumps. Flagged red when the path is invalid.
function treeBasicValue(value: unknown, path: JsonPath, hasError: boolean): HTMLElement {
  const type = valueType(value)
  if (type === 'null') return metaSpan('null', 'jt-null')
  // A boolean's basic value IS the on/off switch — no redundant true/false text
  // field beside it. One control, and it renders reliably (see treeBoolSwitch).
  if (type === 'boolean') return treeBoolSwitch(value, path)
  const input = document.createElement('input')
  input.setAttribute('aria-label', 'value')
  if (hasError) input.classList.add('jt-invalid')
  const sub = state.schema !== null ? resolveSchemaAt(state.schema, path) : null
  const isEnum = sub !== null && Array.isArray(sub.enum)
  input.className = type === 'number' ? 'jt-value jt-num' : isEnum ? 'jt-value' : 'jt-value jt-vstr'
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

// Rich widget shown next to the basic field, only when the schema affords one:
// enum -> radios (≤6) / select, bounded number -> slider, boolean -> toggle switch.
// Returns null for plain fields so those widgets line up in a single column.
function treeRichValue(value: unknown, path: JsonPath): HTMLElement | null {
  const type = valueType(value)
  const sub = state.schema !== null ? resolveSchemaAt(state.schema, path) : null
  const enumVals = sub && Array.isArray(sub.enum) ? sub.enum : null
  if (enumVals && (type === 'string' || type === 'number')) {
    return enumVals.length <= 6 ? treeEnumRadios(enumVals, value, path) : treeEnumSelect(enumVals, value, path)
  }
  if (type === 'number' && sub && typeof sub.minimum === 'number' && typeof sub.maximum === 'number') {
    return treeSlider(sub.minimum, sub.maximum, value, path)
  }
  // boolean is handled by treeBasicValue (the switch is its basic control).
  return null
}

// On/off switch: a <label> track wrapping the checkbox plus a real <span> knob.
// A replaced <input> can't reliably host a pseudo-element knob (that was the old
// fragile radial-gradient hack), so the knob is a genuine element the CSS slides.
function treeBoolSwitch(value: unknown, path: JsonPath): HTMLElement {
  const label = document.createElement('label')
  label.className = 'jt-sw'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'jt-sw-in'
  box.checked = value === true
  box.setAttribute('aria-label', 'toggle')
  box.addEventListener('change', () => applyTreeEdit(jsonSet(state.config, path, box.checked)))
  const knob = document.createElement('span')
  knob.className = 'jt-sw-knob'
  knob.setAttribute('aria-hidden', 'true')
  label.append(box, knob)
  return label
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
// range commits on release. It's the rich, coarse companion to the basic number
// field (which lives in the content zone and takes any precise value).
function treeSlider(min: number, max: number, value: unknown, path: JsonPath): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'jt-slider'
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(min)
  range.max = String(max)
  // Fine step for tight bounds (e.g. a 0..1 ratio), coarse otherwise.
  range.step = max - min <= 2 ? '0.05' : '1'
  range.setAttribute('aria-label', 'value')
  if (typeof value === 'number') range.value = String(value)
  range.addEventListener('change', () => {
    const n = Number(range.value)
    if (Number.isFinite(n)) applyTreeEdit(jsonSet(state.config, path, n))
  })
  wrap.append(range)
  return wrap
}

// "Add child" affordance under a container: a button (arrays) or key + button.
// Indented to the child level (its own row would otherwise sit at the root).
function treeAddRow(container: unknown, path: JsonPath): HTMLElement {
  const row = document.createElement('div')
  row.className = 'jt-row jt-add'
  row.dataset.addpath = pathKey(path)
  row.style.setProperty('--depth', String(path.length))
  row.appendChild(spacer())
  if (Array.isArray(container)) {
    row.appendChild(
      svgIconButton(
        ICON.plus,
        'add item',
        () => applyTreeEdit(jsonInsert(state.config, path, '', defaultForType('string'))),
        ' item',
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
  row.append(keyInput, svgIconButton(ICON.plus, 'add key', add, ' key'))
  return row
}

// The + button on an object header: toggles the (indented) new-key input for
// that object and focuses it, so keys are added from the parent row on demand.
function treeAddKeyToggle(path: JsonPath): HTMLElement {
  const key = pathKey(path)
  const on = addingPaths.has(key)
  const btn = svgIconButton(ICON.plus, on ? 'close new key' : 'add key', () => {
    if (on) addingPaths.delete(key)
    else addingPaths.add(key)
    renderTree()
    if (addingPaths.has(key)) {
      for (const r of treeHost.querySelectorAll<HTMLElement>('.jt-add')) {
        if (r.dataset.addpath === key) {
          r.querySelector('input')?.focus()
          break
        }
      }
    }
  })
  btn.classList.add('jt-addkey')
  if (on) btn.classList.add('active')
  return btn
}

// Flat inline SVG action button with an optional text label.
function svgIconButton(inner: string, label: string, onClick: () => void, text?: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = text === undefined ? 'jt-btn jt-btn--icon' : 'jt-btn'
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.appendChild(svgIcon(inner))
  if (text !== undefined) btn.append(text)
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

// Re-render BOTH Edit views from the current state after a data load. The Block
// form renders into a container that is hidden while the default Tree view is
// active, so calling buildForm() alone leaves the visible Tree stale until a
// tab/mode round-trip triggers renderTree() (the reported "form not updated on
// load" bug). Mirror the project-open path, which already refreshes both.
function refreshEditViews(): void {
  buildForm()
  renderTree()
  renderTreeControls()
}

function loadSchema(value: unknown): void {
  state.schema = value
  schemaRecommend.hidden = true // a schema now exists — drop the recommendation
  refreshEditViews()
}

function loadConfig(value: unknown): void {
  hasLoadedConfig = true
  state.config = value
  refreshEditViews()
  updateConnectionAlert()
}

function loadConfigFromHandle(value: unknown, handle: FileSystemFileHandleLike): void {
  configFileHandle = handle
  loadConfig(value)
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
  // No placeholder: the label text is already shown next to the input, and a
  // placeholder duplicating it is indistinguishable from a real entered value.
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
// The <nav> is now a React component (src/ui/Tabs.tsx) portaled into #tabs-slot.
// It writes the active tab to the shared store; this shell subscribes and applies
// the DOM side effects (panel visibility + view re-sync) it always did.
// Push the current load state into the store so Tabs.tsx can show only the tabs
// that make sense (spec:open-flow REQ-OF09). Called wherever config/schema/history
// availability changes. The store redirects the active tab if it just hid.
function syncTabs(): void {
  useUiStore.getState().setAvailability({
    hasConfig: hasLoadedConfig,
    hasSchema: state.schema !== null,
    hasHistory: historyPaths(history).length > 0,
  })
}

function showTab(target: Tab): void {
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
}
useUiStore.subscribe((s, prev) => {
  if (s.activeTab !== prev.activeTab) showTab(s.activeTab)
})

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

type ProjectConnectionMode = 'replace' | 'preserve-restored'

// When a folder has several JSON candidates, selection is deferred to the
// explorer (Project files). This holds the mode to apply once the user picks —
// so a reconnect picked from the tree still preserves the restored edits.
let pendingPickMode: ProjectConnectionMode = 'replace'

function applyPreservedProjectState(
  config: unknown,
  schema: unknown | null,
  baseline: unknown,
  schemaBaseline: unknown | null,
): void {
  state.config = config
  state.schema = schema
  state.original = clone(baseline)
  state.originalSchema = clone(schemaBaseline)
  baselineEstablished = true
  hasLoadedConfig = true
  if (state.schema !== null) buildForm()
  else {
    renderSchemaTab()
    persist()
    updateDirty()
    renderConfigPreview()
  }
  renderTree()
  renderTreeControls()
}

// Both initial open and reconnect establish the same complete project context.
// Reconnect differs only in preserving recovered config/schema edits.
async function connectProjectConfig(
  dir: FileSystemDirectoryHandleLike,
  fileName: string,
  mode: ProjectConnectionMode,
): Promise<void> {
  schemaRecommend.hidden = true
  const handle = await dir.getFileHandle(fileName)
  const fileText = await (await handle.getFile()).text()
  const parsed = parseJsonFile(fileText)
  if (!parsed.ok) throw new Error(parsed.error)
  const projectSchema = await readJigtorSchema(dir)
  const projectHistory = await readJigtorHistory(dir)

  projectDirectoryHandle = dir
  currentConfigName = fileName
  configFileHandle = handle
  hasConfirmedDownloadMode = false
  history = mode === 'preserve-restored' ? mergeHistories(projectHistory, history) : projectHistory
  persistHistory()
  renderHistoryTab()

  if (mode === 'preserve-restored') {
    const target = prepareProjectReconnect(state.config, state.schema, fileText, projectSchema)
    if (!target.ok) throw new Error(target.error)
    applyPreservedProjectState(
      target.config,
      target.schema,
      target.baseline,
      target.schemaBaseline,
    )
  } else {
    markNewData()
    state.schema = projectSchema
    state.originalSchema = clone(projectSchema)
    loadConfigFromHandle(parsed.value, handle)
  }
  if (state.schema === null) recommendGenerateSchema(fileName)
  await renderProjectTree()
  updateConnectionAlert()
  if (mode === 'preserve-restored') {
    status.textContent = `Connected project ${dir.name}. Review the on-disk diff before saving.`
    status.className = 'status ok'
  }
}

// Multiple candidates: don't pop a cramped button row — show the folder in the
// explorer with every JSON candidate clickable, and let the user pick there. The
// mode is remembered so a reconnect pick still preserves restored edits.
function promptConfigInExplorer(dir: FileSystemDirectoryHandleLike, count: number, mode: ProjectConnectionMode): void {
  projectDirectoryHandle = dir
  currentConfigName = null
  pendingPickMode = mode
  projectPicker.hidden = true
  void renderProjectTree()
  status.textContent = `${count} JSON files here — pick which one to edit in Project files.`
  status.className = 'status'
}

// Connect a config chosen from the explorer, applying the deferred pick mode and
// closing the reconnect gate when the pick completes a reconnect.
async function pickProjectConfig(dir: FileSystemDirectoryHandleLike, fileName: string): Promise<void> {
  const mode = pendingPickMode
  pendingPickMode = 'replace'
  await connectProjectConfig(dir, fileName, mode)
  if (mode === 'preserve-restored') setReconnectGate(false)
}

// Leaving project mode (import / drag-drop / example): there
// is no managed folder anymore, so hide the tree and forget the active file.
function exitProjectMode(): void {
  projectDirectoryHandle = null
  currentConfigName = null
  projectPicker.hidden = true
  projectTree.hidden = true
}

// Compact file-explorer view of only what jigtor manages in the opened folder:
// the editable config plus sibling JSON candidates you can switch to (unrelated
// files are omitted) and the .jigtor/ artifacts. It doubles as the config picker
// — with nothing selected yet, every JSON candidate is clickable to become the
// config. Enumeration reuses the same values() seam as the folder picker.
async function renderProjectTree(): Promise<void> {
  const dir = projectDirectoryHandle
  if (dir === null || typeof dir.values !== 'function') {
    projectTree.hidden = true
    return
  }
  const jsonFiles: string[] = []
  let hasJigtor = false
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      if (entry.name === '.jigtor') hasJigtor = true
    } else if (entry.name.toLowerCase().endsWith('.json')) {
      jsonFiles.push(entry.name)
    }
  }
  const jigtorFiles = hasJigtor ? await listDirNames(dir, '.jigtor') : []

  projectTreeBody.replaceChildren(
    treeDirNode(dir.name, buildProjectChildren(dir, jsonFiles.sort(), hasJigtor, jigtorFiles.sort())),
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

// Root children: the .jigtor/ artifacts (if present) then the JSON candidates.
// Every non-active JSON is clickable — this is also how you pick the config when
// none is chosen yet; the active one is badged "editing".
function buildProjectChildren(
  dir: FileSystemDirectoryHandleLike,
  jsonFiles: string[],
  hasJigtor: boolean,
  jigtorFiles: string[],
): HTMLUListElement {
  const ul = document.createElement('ul')
  if (hasJigtor) {
    ul.appendChild(
      treeDirNode(
        '.jigtor',
        treeChildList(jigtorFiles.map((f) => treeFileNode(f, { badge: JIGTOR_ROLES[f], muted: true }))),
      ),
    )
  }
  const picking = currentConfigName === null
  for (const name of jsonFiles) {
    const isActive = name === currentConfigName
    // Initial pick (nothing chosen) honours the deferred reconnect mode; switching
    // an already-open config is a plain replace.
    const connect = (): Promise<void> =>
      picking ? pickProjectConfig(dir, name) : connectProjectConfig(dir, name, 'replace')
    ul.appendChild(
      treeFileNode(name, {
        active: isActive,
        badge: isActive ? 'editing' : picking ? 'pick' : undefined,
        onClick: !isActive
          ? () =>
              void connect().catch((e) => {
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
  label.append(svgIcon(ICON.folder), name)
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
  label.replaceChildren(svgIcon(ICON.file), document.createTextNode(name))
  li.appendChild(label)
  if (opts.badge) {
    const badge = document.createElement('span')
    badge.className = 'tree-badge'
    badge.textContent = opts.badge
    li.appendChild(badge)
  }
  return li
}

async function openProjectFolder(mode: ProjectConnectionMode): Promise<boolean> {
  if (!canUseProjectAccess()) {
    status.textContent = 'Project-folder save requires a Chromium-based browser with directory access support.'
    status.className = 'status error'
    return false
  }
  projectPicker.hidden = true
  const dir = await filePickerWindow.showDirectoryPicker!()
  const candidates = await listRootJsonFiles(dir)
  const [first] = candidates
  if (first === undefined) {
    // A folder with no JSON isn't a project: clear any previously-shown tree so
    // the stale explorer + edit state don't imply this empty folder is loaded.
    exitProjectMode()
    status.textContent = 'No .json files in this folder. Add a config.json and open the folder again.'
    status.className = 'status error'
    return false
  }
  if (candidates.length === 1) {
    await connectProjectConfig(dir, first, mode)
    return true
  }
  // Several candidates: defer the choice to the explorer (roomier than a button
  // row, and consistent with switching config later). Not connected yet, so the
  // caller must not treat this as a completed reconnect.
  promptConfigInExplorer(dir, candidates.length, mode)
  return false
}

openProjectBtn.addEventListener('click', () => {
  const mode: ProjectConnectionMode =
    hasLoadedConfig && projectDirectoryHandle === null ? 'preserve-restored' : 'replace'
  void openProjectFolder(mode)
    .then((connected) => {
      if (connected && mode === 'preserve-restored') setReconnectGate(false)
    })
    .catch((e) => {
      status.textContent = `Could not open project folder: ${String(e)}`
      status.className = 'status error'
    })
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
  useUiStore.getState().setActiveTab('schema')
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

app.querySelector<HTMLButtonElement>('#apply-schema')!.addEventListener('click', () => {
  const parsed = parseJsonFile(schemaEditor.value)
  if (!parsed.ok) {
    schemaMsg.textContent = parsed.error
    return
  }
  schemaMsg.textContent = 'applied'
  loadSchema(parsed.value)
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
  // Write the config in its OWN key order: value edits preserve order (jsonSet /
  // setAt rebuild in place) and an intentional ↑↓ move is a real reorder we want
  // to persist. No orderLike normalisation here — that would erase moves.
  if (projectDirectoryHandle !== null && configFileHandle !== null) {
    if (!(await ensureWritablePermission(configFileHandle))) {
      throw new Error('write permission was not granted')
    }
    await writeFileHandle(configFileHandle, serializeConfig(state.config))
    return 'direct'
  }
  download()
  return 'download'
}

async function reconnectProjectForSave(): Promise<boolean> {
  return openProjectFolder('preserve-restored')
}

function markSaved(): void {
  // spec:history (REQ-H01): append a full-config snapshot of this saved version,
  // then advance the baseline.
  history = recordSnapshot(history, state.config, Date.now())
  persistHistory()
  renderHistoryTab()
  state.original = clone(state.config) // new baseline after a save
  state.canonical = clone(state.config) // the saved key order becomes canonical
  state.originalSchema = clone(state.schema)
  saveDialog.hidden = true
  syncTabs() // first save creates history — the History tab becomes available
  updateDirty()
  revalidate() // clear per-field dirty decoration now that everything is saved
}

function reconnectFromSaveDialog(button: HTMLButtonElement): void {
  button.disabled = true
  void reconnectProjectForSave()
    .then((connected) => {
      if (connected) renderSaveDialog()
      else button.disabled = false
    })
    .catch((e) => {
      button.disabled = false
      status.textContent = `Could not connect project folder: ${String(e)}`
      status.className = 'status error'
    })
}

function renderSaveDialog(): void {
  const changes = diffConfig(state.original, state.config)
  const hasSchemaChanges = JSON.stringify(state.originalSchema) !== JSON.stringify(state.schema)
  const result = state.schema !== null ? validateConfig(state.schema, state.config) : null

  saveDialog.replaceChildren()
  const title = document.createElement('h3')
  title.textContent = 'Review changes'
  saveDialog.appendChild(title)

  if (hasSchemaChanges) {
    const schemaNote = document.createElement('p')
    schemaNote.className = 'status'
    schemaNote.textContent = 'Schema has unsaved changes and will be written to .jigtor/schema.json.'
    saveDialog.appendChild(schemaNote)
  }

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
    // The whole-file diff is always visible in the Live diff panel, so the dialog
    // only needs to confirm how much is about to be written.
    const summary = document.createElement('p')
    summary.className = 'hint'
    const n = changes.length
    summary.textContent = `${n} change${n === 1 ? '' : 's'} to save — see the Live diff for the full file.`
    saveDialog.appendChild(summary)
  }

  const actions = document.createElement('div')
  actions.className = 'schema-actions'
  const saveAction = document.createElement('button')
  saveAction.type = 'button'
  const targetMode = saveTargetMode()
  if (targetMode === 'reconnect-required') {
    const reconnectHint = document.createElement('p')
    reconnectHint.className = 'hint'
    reconnectHint.textContent = 'Reconnect the original folder to keep project files in sync.'
    saveDialog.appendChild(reconnectHint)
    saveAction.replaceChildren(svgIcon(ICON.folder), document.createTextNode('Reconnect project folder…'))
    saveAction.addEventListener('click', () => reconnectFromSaveDialog(saveAction))
  } else {
    const directName = targetMode === 'direct' ? configFileHandle?.name : undefined
    const isDirect = directName !== undefined
    saveAction.replaceChildren(
      svgIcon(isDirect ? ICON.save : ICON.download),
      document.createTextNode(isDirect ? `Save ${directName}` : 'Download config.json'),
    )
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
  actions.appendChild(saveAction)
  if (targetMode === 'download' && canUseProjectAccess()) {
    const reconnectAction = document.createElement('button')
    reconnectAction.type = 'button'
    reconnectAction.replaceChildren(svgIcon(ICON.folder), document.createTextNode('Reconnect project instead…'))
    reconnectAction.addEventListener('click', () => reconnectFromSaveDialog(reconnectAction))
    actions.appendChild(reconnectAction)
  }
  actions.appendChild(cancel)
  saveDialog.appendChild(actions)
  saveDialog.hidden = false
}

app.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => {
  renderSaveDialog()
})

// Prompt before leaving with unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})

reconnectGateAction.addEventListener('click', () => {
  reconnectGateAction.disabled = true
  reconnectGateStatus.hidden = true
  void reconnectProjectForSave()
    .then((connected) => {
      reconnectGateAction.disabled = false
      if (connected) setReconnectGate(false)
    })
    .catch((e) => {
      reconnectGateAction.disabled = false
      reconnectGateStatus.textContent = `Could not connect project folder: ${String(e)}`
      reconnectGateStatus.hidden = false
    })
})

connectionReconnect.addEventListener('click', () => {
  connectionReconnect.disabled = true
  void reconnectProjectForSave()
    .then(() => {
      connectionReconnect.disabled = false
    })
    .catch((e) => {
      connectionReconnect.disabled = false
      status.textContent = `Could not connect project folder: ${String(e)}`
      status.className = 'status error'
    })
})

downloadModeAction.addEventListener('click', () => {
  hasConfirmedDownloadMode = true
  setReconnectGate(false)
  status.textContent = 'Download mode enabled. Save will download config.json.'
  status.className = 'status'
})

// ---- startup: restore the last session if present ----
const restored = restoreSaved()
buildForm()
renderHistoryTab() // show persisted save history from previous sessions
setEditMode('tree') // default the Edit tab to the Tree editor
if (restored) {
  reconnectGateAction.disabled = !canUseProjectAccess()
  reconnectGateStatus.textContent = canUseProjectAccess()
    ? ''
    : 'Folder access is unavailable. Use Download mode.'
  reconnectGateStatus.hidden = canUseProjectAccess()
  status.textContent = 'Session restored. Reconnect the project before editing.'
  status.className = 'status'
  setReconnectGate(true)
}

} // end mountLegacyApp
