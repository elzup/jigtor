// spec:renderer — FieldNode tree -> DOM form.
// The control structure is built ONCE (renderNode); validation errors are shown
// through per-field `.field-errbox` containers that `refreshErrors` updates in
// place, so re-validating on every edit never recreates the input the user is
// interacting with (fixes slider-drag / text-caret jank — REQ-R16).
import type { ArrayField, FieldError, FieldNode, FieldPath } from './types'

export type OnChange = (path: FieldPath, value: unknown) => void

// string fields whose maxLength reaches this render as a <textarea> (REQ-R12).
const LONG_STRING_THRESHOLD = 80
// string enums with at most this many options render as radios, else a <select>.
const ENUM_RADIO_MAX = 6

const pathKey = (path: FieldPath): string => path.join('/')
// Human-facing dotted path, root-anchored: [] -> "." , ['a','b'] -> ".a.b" (REQ-R17).
const dotPath = (path: FieldPath): string => (path.length ? `.${path.join('.')}` : '.')

function pathTag(path: FieldPath): HTMLElement {
  const code = document.createElement('code')
  code.className = 'field-path'
  code.textContent = dotPath(path)
  return code
}
// Collision-free key for matching a FieldError to its errbox. `pathKey` ('/')
// is ambiguous for property names containing '/', e.g. ['a/b'] vs ['a','b'];
// JSON.stringify of the array segments is unambiguous.
const errKey = (path: FieldPath): string => JSON.stringify(path)

function getAt(value: unknown, path: FieldPath): unknown {
  let cur = value
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

// Empty, position-stable container that refreshErrors fills for this field.
function errBox(path: FieldPath): HTMLElement {
  const box = document.createElement('div')
  box.className = 'field-errbox'
  box.setAttribute('data-errpath', errKey(path))
  return box
}

// REQ-R18: position-stable per-field meta row that refreshFieldMeta fills with a
// live value chip, and — when the field differs from the saved baseline — the
// previous value plus a reset button. Leaf fields only (objects are containers).
function metaBox(path: FieldPath): HTMLElement {
  const box = document.createElement('div')
  box.className = 'field-meta'
  box.setAttribute('data-metapath', errKey(path))
  return box
}

const fmtJson = (v: unknown): string => (v === undefined ? '∅' : JSON.stringify(v))
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function descriptionEl(field: FieldNode): HTMLElement | null {
  if (!field.description) return null
  const desc = document.createElement('p')
  desc.className = 'field-description'
  desc.textContent = field.description
  return desc
}

function labelEl(field: FieldNode): HTMLLabelElement {
  const label = document.createElement('label')
  const name = document.createElement('span')
  name.className = 'field-name'
  name.textContent = field.required ? `${field.label} *` : field.label
  label.append(name, pathTag(field.path)) // REQ-R17: dotted path on every field
  label.setAttribute('data-path', pathKey(field.path))
  return label
}

// REQ-R20: array (list) editing. Primitive item types get per-item rows
// (add / remove / reorder); object or otherwise-complex items fall back to a
// live-parsed JSON textarea. Item inputs follow REQ-R19 (no native constraints).
const PRIMITIVE_ITEM_KINDS = new Set(['string', 'number', 'boolean'])

function itemDefault(item: FieldNode): unknown {
  if (item.kind === 'boolean') return false
  if (item.kind === 'number') return 0
  if (item.kind === 'string' && item.enum) return item.enum[0] ?? ''
  return ''
}

function primitiveItemInput(
  item: FieldNode,
  value: unknown,
  onInput: (v: unknown) => void,
): HTMLElement {
  if (item.kind === 'boolean') {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'toggle'
    cb.checked = value === true
    cb.addEventListener('change', () => onInput(cb.checked))
    return cb
  }
  if (item.kind === 'number') {
    const n = document.createElement('input')
    n.type = 'number'
    if (typeof value === 'number') n.value = String(value)
    n.addEventListener('input', () => onInput(n.value === '' ? undefined : Number(n.value)))
    return n
  }
  if (item.kind === 'string' && item.enum) {
    const s = document.createElement('select')
    for (const opt of item.enum) {
      const o = document.createElement('option')
      o.value = opt
      o.textContent = opt
      s.appendChild(o)
    }
    if (typeof value === 'string') s.value = value
    s.addEventListener('change', () => onInput(s.value))
    return s
  }
  const t = document.createElement('input')
  t.type = 'text'
  if (typeof value === 'string') t.value = value
  t.addEventListener('input', () => onInput(t.value))
  return t
}

function iconBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

// Per-item editable list for arrays of primitives. Value edits update the array
// WITHOUT redrawing rows (keeps caret/focus — REQ-R16); add/remove/reorder redraw.
function primitiveArrayEditor(
  field: ArrayField,
  current: unknown,
  onChange: OnChange,
): HTMLElement {
  const editor = document.createElement('div')
  editor.className = 'field-array-editor'
  editor.setAttribute('data-path', pathKey(field.path))
  let items = Array.isArray(current) ? [...current] : []
  const rows = document.createElement('div')
  rows.className = 'array-rows'
  const emit = () => onChange(field.path, items)

  const drawRows = (): void => {
    rows.replaceChildren()
    items.forEach((val, i) => {
      const row = document.createElement('div')
      row.className = 'array-row'
      const input = primitiveItemInput(field.item, val, (v) => {
        items = items.map((x, j) => (j === i ? v : x))
        emit()
      })
      const up = iconBtn('↑', 'array-btn', () => {
        if (i === 0) return
        const next = [...items]
        ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
        items = next
        emit()
        drawRows()
      })
      const down = iconBtn('↓', 'array-btn', () => {
        if (i >= items.length - 1) return
        const next = [...items]
        ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
        items = next
        emit()
        drawRows()
      })
      const rm = iconBtn('✕', 'array-btn array-rm', () => {
        items = items.filter((_, j) => j !== i)
        emit()
        drawRows()
      })
      row.append(input, up, down, rm)
      rows.appendChild(row)
    })
  }

  const add = iconBtn('+ add item', 'array-add', () => {
    items = [...items, itemDefault(field.item)]
    emit()
    drawRows()
  })
  drawRows()
  editor.append(rows, add)
  return editor
}

// Fallback for object/complex item types: edit the whole array as JSON text,
// committing only when it parses (invalid JSON shows an inline note).
function jsonArrayEditor(
  field: ArrayField,
  current: unknown,
  onChange: OnChange,
): HTMLElement {
  const box = document.createElement('div')
  box.className = 'field-array-json'
  const ta = document.createElement('textarea')
  ta.className = 'array-json'
  ta.setAttribute('data-path', pathKey(field.path))
  ta.value = JSON.stringify(current ?? [], null, 2)
  const note = document.createElement('p')
  note.className = 'field-error'
  note.hidden = true
  ta.addEventListener('input', () => {
    try {
      const parsed = JSON.parse(ta.value)
      note.hidden = true
      onChange(field.path, parsed)
    } catch {
      note.hidden = false
      note.textContent = 'invalid JSON — fix to apply'
    }
  })
  box.append(ta, note)
  return box
}

function renderNode(field: FieldNode, value: unknown, onChange: OnChange): HTMLElement {
  if (field.kind === 'object') {
    // REQ-R04: the ROOT object (depth 0) renders WITHOUT the fieldset/legend
    // chrome — it always wraps the whole form, so the extra box + "." legend is
    // just noise. Nested objects keep their titled fieldset.
    const isRoot = field.path.length === 0
    const box = document.createElement(isRoot ? 'div' : 'fieldset')
    if (isRoot) {
      box.className = 'form-root'
    } else {
      const legend = document.createElement('legend')
      const legendName = document.createElement('span')
      legendName.className = 'field-name'
      legendName.textContent = field.required ? `${field.label} *` : field.label
      legend.append(legendName, pathTag(field.path)) // REQ-R17: dotted path on objects too
      box.appendChild(legend)
    }
    const desc = descriptionEl(field)
    if (desc) box.appendChild(desc)
    // REQ-R06: errors targeting the object node itself land here (root included).
    box.appendChild(errBox(field.path))
    for (const child of field.children) {
      box.appendChild(renderNode(child, getAt(value, [child.path.at(-1)!]), onChange))
    }
    return box
  }

  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.appendChild(labelEl(field))
  const current = value
  const finish = (): HTMLElement => {
    const desc = descriptionEl(field)
    if (desc) wrap.appendChild(desc)
    wrap.appendChild(metaBox(field.path)) // REQ-R18: live value + dirty/reset
    wrap.appendChild(errBox(field.path))
    return wrap
  }

  if (field.kind === 'unknown') {
    // REQ-P10 / REQ-R06: read-only placeholder for a schema V1 can't render.
    wrap.classList.add('field-unknown')
    const note = document.createElement('p')
    note.className = 'field-description'
    note.textContent = `Unsupported in V1 (${field.reason}); edit this field in the file directly.`
    const pre = document.createElement('pre')
    pre.className = 'field-array'
    pre.setAttribute('data-path', pathKey(field.path))
    pre.textContent = JSON.stringify(current ?? null, null, 2)
    wrap.append(note, pre)
    return finish()
  }

  if (field.kind === 'array') {
    // REQ-R20: primitive item arrays -> per-item rows; complex -> JSON textarea.
    const editor = PRIMITIVE_ITEM_KINDS.has(field.item.kind)
      ? primitiveArrayEditor(field, current, onChange)
      : jsonArrayEditor(field, current, onChange)
    wrap.appendChild(editor)
    return finish()
  }

  // REQ-R11: number with both bounds -> range slider + synced number input.
  if (field.kind === 'number' && field.minimum !== undefined && field.maximum !== undefined) {
    const step = field.integer ? '1' : 'any'
    const range = document.createElement('input')
    range.type = 'range'
    range.min = String(field.minimum)
    range.max = String(field.maximum)
    range.step = step
    const num = document.createElement('input')
    num.type = 'number'
    // REQ-R19: the paired number input is unconstrained (no min/max/step) so any
    // value can be typed freely; the range is just a coarse in-bounds helper and
    // schema violations surface as ajv warnings, not input blocking.
    if (typeof current === 'number') {
      range.value = String(current)
      num.value = String(current)
    }
    const emit = (raw: string, peer: HTMLInputElement) => {
      peer.value = raw
      onChange(field.path, raw === '' ? undefined : Number(raw))
    }
    range.addEventListener('input', () => emit(range.value, num))
    num.addEventListener('input', () => emit(num.value, range))
    range.setAttribute('data-path', pathKey(field.path))
    num.setAttribute('data-path', pathKey(field.path))
    const slot = document.createElement('div')
    slot.className = 'field-slider'
    slot.append(range, num)
    wrap.appendChild(slot)
    return finish()
  }

  // REQ-R15: small string enum -> radio group (exclusive), else <select>.
  if (field.kind === 'string' && field.enum && field.enum.length <= ENUM_RADIO_MAX) {
    const group = document.createElement('div')
    group.className = 'field-radios'
    const name = pathKey(field.path)
    for (const opt of field.enum) {
      const optLabel = document.createElement('label')
      optLabel.className = 'radio-option'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = name
      radio.value = opt
      radio.checked = current === opt
      radio.setAttribute('data-path', name)
      radio.addEventListener('change', () => {
        if (radio.checked) onChange(field.path, opt)
      })
      optLabel.append(radio, document.createTextNode(` ${opt}`))
      group.appendChild(optLabel)
    }
    wrap.appendChild(group)
    return finish()
  }

  // REQ-R12: long string (no enum) -> textarea.
  if (field.kind === 'string' && !field.enum && (field.maxLength ?? 0) >= LONG_STRING_THRESHOLD) {
    const ta = document.createElement('textarea')
    // REQ-R19: no maxLength cap — type freely, ajv warns if too long.
    if (typeof current === 'string') ta.value = current
    ta.addEventListener('input', () => onChange(field.path, ta.value))
    ta.setAttribute('data-path', pathKey(field.path))
    wrap.appendChild(ta)
    return finish()
  }

  let control: HTMLInputElement | HTMLSelectElement

  if (field.kind === 'string' && field.enum) {
    const select = document.createElement('select')
    for (const opt of field.enum) {
      const o = document.createElement('option')
      o.value = opt
      o.textContent = opt
      select.appendChild(o)
    }
    if (typeof current === 'string') select.value = current
    select.addEventListener('change', () => onChange(field.path, select.value))
    control = select
  } else if (field.kind === 'boolean') {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'toggle' // REQ-R13: toggle appearance via CSS, checkbox behavior
    input.checked = current === true
    input.addEventListener('change', () => onChange(field.path, input.checked))
    control = input
  } else if (field.kind === 'number') {
    const input = document.createElement('input')
    input.type = 'number'
    // REQ-R19: no min/max/step — free numeric entry; ajv reports out-of-range
    // or non-integer as a warning instead of blocking input.
    if (typeof current === 'number') input.value = String(current)
    input.addEventListener('input', () => {
      onChange(field.path, input.value === '' ? undefined : Number(input.value))
    })
    control = input
  } else {
    // string without enum
    const input = document.createElement('input')
    input.type = 'text'
    // REQ-R19: no native pattern/maxLength — type freely; ajv surfaces pattern
    // or length violations as warnings rather than blocking input.
    if (typeof current === 'string') input.value = current
    input.addEventListener('input', () => onChange(field.path, input.value))
    control = input
  }

  control.setAttribute('data-path', pathKey(field.path))
  wrap.appendChild(control)
  return finish()
}

// REQ-R06/R09/R16: (re)place validation errors into the per-field errboxes
// WITHOUT touching any input control. Errors whose path matches no errbox go to
// a form-level `.form-errors` summary so nothing is ever invisible.
export function refreshErrors(formEl: HTMLElement, errors: FieldError[]): void {
  const boxes = new Map<string, Element>()
  formEl.querySelectorAll('.field-errbox').forEach((b) => {
    b.replaceChildren()
    boxes.set(b.getAttribute('data-errpath') ?? '', b)
  })
  formEl.querySelector('.form-errors')?.remove()

  const orphans: FieldError[] = []
  for (const err of errors) {
    const box = boxes.get(errKey(err.path))
    if (!box) {
      orphans.push(err)
      continue
    }
    const e = document.createElement('p')
    e.className = 'field-error'
    e.textContent = err.message
    box.appendChild(e)
  }
  if (orphans.length > 0) {
    const summary = document.createElement('div')
    summary.className = 'form-errors'
    for (const err of orphans) {
      const e = document.createElement('p')
      e.className = 'field-error'
      const where = err.path.length > 0 ? `${err.path.join('.')}: ` : ''
      e.textContent = `${where}${err.message}`
      summary.appendChild(e)
    }
    formEl.appendChild(summary)
  }
}

export type OnReset = (path: FieldPath) => void

// REQ-R18: refresh each leaf field's meta row IN PLACE (no input rebuild, same
// contract as refreshErrors). Shows the live current value; when a field differs
// from `baseline`, marks its `.field` dirty, shows the previous value, and offers
// a reset button wired to `onReset(path)`.
export function refreshFieldMeta(
  formEl: HTMLElement,
  baseline: unknown,
  current: unknown,
  onReset: OnReset,
): void {
  formEl.querySelectorAll('.field').forEach((f) => f.classList.remove('field-dirty'))
  formEl.querySelectorAll('.field-meta').forEach((box) => {
    box.replaceChildren()
    const raw = box.getAttribute('data-metapath')
    if (raw === null) return
    const path = JSON.parse(raw) as FieldPath
    const cur = getAt(current, path)
    const base = getAt(baseline, path)
    const key = JSON.stringify(String(path.at(-1) ?? '')) // "enabled"
    const pair = (v: unknown): string => `${key}: ${fmtJson(v)}` // "enabled": false

    // Unchanged: a single live "key": value line (per-field live preview).
    if (sameJson(cur, base)) {
      const val = document.createElement('span')
      val.className = 'fv'
      val.textContent = pair(cur)
      box.appendChild(val)
      return
    }

    // Changed: show the transition directly —  "enabled": true  →  "enabled": false
    box.closest('.field')?.classList.add('field-dirty')
    const before = document.createElement('span')
    before.className = 'fv fv-before'
    before.textContent = pair(base)
    const after = document.createElement('span')
    after.className = 'fv fv-after'
    after.textContent = `→ ${pair(cur)}`
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'fv-reset'
    reset.textContent = 'reset'
    reset.addEventListener('click', () => onReset(path))
    box.append(before, after, reset)
  })
}

export function renderForm(
  root: FieldNode,
  value: unknown,
  errors: FieldError[],
  onChange: OnChange,
): HTMLElement {
  const form = document.createElement('form')
  form.className = 'jigtor-form'
  form.appendChild(renderNode(root, value, onChange))
  refreshErrors(form, errors)
  return form
}
