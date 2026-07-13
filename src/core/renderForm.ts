// spec:renderer — FieldNode tree -> DOM form.
// The control structure is built ONCE (renderNode); validation errors are shown
// through per-field `.field-errbox` containers that `refreshErrors` updates in
// place, so re-validating on every edit never recreates the input the user is
// interacting with (fixes slider-drag / text-caret jank — REQ-R16).
import type { FieldError, FieldNode, FieldPath } from './types'

export type OnChange = (path: FieldPath, value: unknown) => void

// string fields whose maxLength reaches this render as a <textarea> (REQ-R12).
const LONG_STRING_THRESHOLD = 80
// string enums with at most this many options render as radios, else a <select>.
const ENUM_RADIO_MAX = 6

const pathKey = (path: FieldPath): string => path.join('/')
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

function descriptionEl(field: FieldNode): HTMLElement | null {
  if (!field.description) return null
  const desc = document.createElement('p')
  desc.className = 'field-description'
  desc.textContent = field.description
  return desc
}

function labelEl(field: FieldNode): HTMLLabelElement {
  const label = document.createElement('label')
  label.textContent = field.required ? `${field.label} *` : field.label
  label.setAttribute('data-path', pathKey(field.path))
  return label
}

function renderNode(field: FieldNode, value: unknown, onChange: OnChange): HTMLElement {
  if (field.kind === 'object') {
    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = field.required ? `${field.label} *` : field.label
    fieldset.appendChild(legend)
    const desc = descriptionEl(field)
    if (desc) fieldset.appendChild(desc)
    // REQ-R06: errors targeting the object node itself land here.
    fieldset.appendChild(errBox(field.path))
    for (const child of field.children) {
      fieldset.appendChild(renderNode(child, getAt(value, [child.path.at(-1)!]), onChange))
    }
    return fieldset
  }

  const wrap = document.createElement('div')
  wrap.className = 'field'
  wrap.appendChild(labelEl(field))
  const current = value
  const finish = (): HTMLElement => {
    const desc = descriptionEl(field)
    if (desc) wrap.appendChild(desc)
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
    // V1: arrays shown read-only as JSON text; editing arrays is deferred.
    const pre = document.createElement('pre')
    pre.className = 'field-array'
    pre.setAttribute('data-path', pathKey(field.path))
    pre.textContent = JSON.stringify(current ?? [], null, 2)
    wrap.appendChild(pre)
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
    if (field.maxLength !== undefined) ta.maxLength = field.maxLength
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
