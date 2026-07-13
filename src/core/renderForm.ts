// spec:renderer — FieldNode tree -> DOM form.
import type { FieldError, FieldNode, FieldPath } from './types'

export type OnChange = (path: FieldPath, value: unknown) => void

// string fields whose maxLength reaches this render as a <textarea> (REQ-R12).
const LONG_STRING_THRESHOLD = 80

const pathKey = (path: FieldPath): string => path.join('/')

function getAt(value: unknown, path: FieldPath): unknown {
  let cur = value
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function errorsFor(errors: FieldError[], path: FieldPath): FieldError[] {
  const key = pathKey(path)
  return errors.filter((e) => pathKey(e.path) === key)
}

function labelEl(field: FieldNode): HTMLLabelElement {
  const label = document.createElement('label')
  label.textContent = field.required ? `${field.label} *` : field.label
  label.setAttribute('data-path', pathKey(field.path))
  return label
}

function appendErrorsAndDescription(
  container: HTMLElement,
  field: FieldNode,
  errors: FieldError[],
): void {
  if (field.description) {
    const desc = document.createElement('p')
    desc.className = 'field-description'
    desc.textContent = field.description
    container.appendChild(desc)
  }
  for (const err of errorsFor(errors, field.path)) {
    const e = document.createElement('p')
    e.className = 'field-error'
    e.textContent = err.message
    container.appendChild(e)
  }
}

function renderNode(
  field: FieldNode,
  value: unknown,
  errors: FieldError[],
  onChange: OnChange,
): HTMLElement {
  if (field.kind === 'object') {
    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = field.required ? `${field.label} *` : field.label
    fieldset.appendChild(legend)
    if (field.description) {
      const desc = document.createElement('p')
      desc.className = 'field-description'
      desc.textContent = field.description
      fieldset.appendChild(desc)
    }
    // REQ-R06: errors targeting the object node itself (e.g. "must be object",
    // required-property-missing) must still be shown, not only leaf errors.
    for (const err of errorsFor(errors, field.path)) {
      const e = document.createElement('p')
      e.className = 'field-error'
      e.textContent = err.message
      fieldset.appendChild(e)
    }
    for (const child of field.children) {
      fieldset.appendChild(renderNode(child, getAt(value, [child.path.at(-1)!]), errors, onChange))
    }
    return fieldset
  }

  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.appendChild(labelEl(field))
  const current = value

  if (field.kind === 'unknown') {
    // REQ-P10 / REQ-R06: read-only placeholder for a schema V1 can't render.
    // Shown so any validation error on a required-but-unsupported field lands
    // somewhere the user can see.
    wrap.classList.add('field-unknown')
    if (field.description) {
      // REQ-R08: author-provided description must still be shown.
      const desc = document.createElement('p')
      desc.className = 'field-description'
      desc.textContent = field.description
      wrap.appendChild(desc)
    }
    const note = document.createElement('p')
    note.className = 'field-description'
    note.textContent = `Unsupported in V1 (${field.reason}); edit this field in the file directly.`
    wrap.appendChild(note)
    const pre = document.createElement('pre')
    pre.className = 'field-array'
    pre.setAttribute('data-path', pathKey(field.path))
    pre.textContent = JSON.stringify(current ?? null, null, 2)
    wrap.appendChild(pre)
    for (const err of errorsFor(errors, field.path)) {
      const e = document.createElement('p')
      e.className = 'field-error'
      e.textContent = err.message
      wrap.appendChild(e)
    }
    return wrap
  }

  if (field.kind === 'array') {
    // V1: arrays shown read-only as JSON text; editing arrays is deferred.
    const pre = document.createElement('pre')
    pre.className = 'field-array'
    pre.setAttribute('data-path', pathKey(field.path))
    pre.textContent = JSON.stringify(current ?? [], null, 2)
    wrap.appendChild(pre)
    appendErrorsAndDescription(wrap, field, errors)
    return wrap
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
    num.min = String(field.minimum)
    num.max = String(field.maximum)
    num.step = step
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
    appendErrorsAndDescription(wrap, field, errors)
    return wrap
  }

  // REQ-R12: long string (no enum) -> textarea.
  if (field.kind === 'string' && !field.enum && (field.maxLength ?? 0) >= LONG_STRING_THRESHOLD) {
    const ta = document.createElement('textarea')
    if (field.maxLength !== undefined) ta.maxLength = field.maxLength
    if (typeof current === 'string') ta.value = current
    ta.addEventListener('input', () => onChange(field.path, ta.value))
    ta.setAttribute('data-path', pathKey(field.path))
    wrap.appendChild(ta)
    appendErrorsAndDescription(wrap, field, errors)
    return wrap
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
    if (field.integer) input.step = '1'
    if (field.minimum !== undefined) input.min = String(field.minimum)
    if (field.maximum !== undefined) input.max = String(field.maximum)
    if (typeof current === 'number') input.value = String(current)
    input.addEventListener('input', () => {
      onChange(field.path, input.value === '' ? undefined : Number(input.value))
    })
    control = input
  } else {
    // string without enum
    const input = document.createElement('input')
    input.type = 'text'
    if (field.kind === 'string') {
      if (field.pattern) input.pattern = field.pattern
      if (field.maxLength !== undefined) input.maxLength = field.maxLength
    }
    if (typeof current === 'string') input.value = current
    input.addEventListener('input', () => onChange(field.path, input.value))
    control = input
  }

  control.setAttribute('data-path', pathKey(field.path))
  wrap.appendChild(control)
  appendErrorsAndDescription(wrap, field, errors)
  return wrap
}

// Every path that renderNode produces a render target for (object nodes, leaf
// controls, unknown placeholders) — used to detect errors that would otherwise
// be invisible (REQ-R09).
function collectRenderedPaths(field: FieldNode, into: Set<string>): void {
  into.add(pathKey(field.path))
  if (field.kind === 'object') {
    for (const child of field.children) collectRenderedPaths(child, into)
  }
  // array item controls are not individually rendered in V1 (read-only JSON),
  // so array element paths intentionally are not added.
}

export function renderForm(
  root: FieldNode,
  value: unknown,
  errors: FieldError[],
  onChange: OnChange,
): HTMLElement {
  const form = document.createElement('form')
  form.className = 'jigtor-form'
  form.appendChild(renderNode(root, value, errors, onChange))

  // REQ-R09: errors whose path has no rendered field must still be shown, so no
  // validation error is ever invisible / unresolvable from the UI.
  const rendered = new Set<string>()
  collectRenderedPaths(root, rendered)
  const orphans = errors.filter((e) => !rendered.has(pathKey(e.path)))
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
    form.appendChild(summary)
  }
  return form
}
