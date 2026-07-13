import { describe, test, expect } from 'vitest'
import { renderForm, refreshErrors, refreshFieldMeta } from '../src/core/renderForm'
import { parseSchema } from '../src/core/parseSchema'
import type { FieldError } from '../src/core/types'

function build(schema: unknown, value: unknown, errors: FieldError[] = []) {
  const r = parseSchema(schema)
  if (!r.ok) throw new Error('bad schema: ' + r.error)
  const changes: Array<{ path: string[]; value: unknown }> = []
  const el = renderForm(r.root, value, errors, (path, v) => changes.push({ path, value: v }))
  return { el, changes }
}

const schema = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', description: 'the key' },
    mode: { type: 'string', enum: ['a', 'b'] },
    max: { type: 'integer' },
    ratio: { type: 'number' },
    on: { type: 'boolean' },
    nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
  },
}

describe('spec:renderer', () => {
  test('REQ-R01/R15: small enum string -> radio group, plain string -> text input', () => {
    const { el } = build(schema, {})
    // `mode` enum has 2 options (<= 6) -> radios, not a select
    expect(el.querySelector('input[type="radio"][data-path="mode"]')).toBeTruthy()
    expect(el.querySelector('select[data-path="mode"]')).toBeNull()
    const textInputs = el.querySelectorAll('input[type="text"]')
    expect(textInputs.length).toBeGreaterThanOrEqual(1)
  })

  test('REQ-R15: radio group has one input per option, sharing a name, current checked', () => {
    const { el } = build(schema, { mode: 'b' })
    const radios = el.querySelectorAll<HTMLInputElement>('input[type="radio"][data-path="mode"]')
    expect(radios.length).toBe(2)
    const names = new Set(Array.from(radios).map((r) => r.name))
    expect(names.size).toBe(1) // exclusive group
    const checked = Array.from(radios).find((r) => r.checked)
    expect(checked!.value).toBe('b')
  })

  test('REQ-R15: selecting a radio fires onChange(path, value)', () => {
    const { el, changes } = build(schema, { mode: 'a' })
    const radios = el.querySelectorAll<HTMLInputElement>('input[type="radio"][data-path="mode"]')
    const b = Array.from(radios).find((r) => r.value === 'b')!
    b.checked = true
    b.dispatchEvent(new Event('change', { bubbles: true }))
    expect(changes).toContainEqual({ path: ['mode'], value: 'b' })
  })

  test('REQ-R15: large enum (>6) falls back to select', () => {
    const big = {
      type: 'object',
      properties: {
        n: { type: 'string', enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, // 7 options
      },
    }
    const { el } = build(big, {})
    expect(el.querySelector('select[data-path="n"]')).toBeTruthy()
    expect(el.querySelector('input[type="radio"][data-path="n"]')).toBeNull()
  })

  test('REQ-R02: number -> number input; integer gets step=1', () => {
    const { el } = build(schema, {})
    const nums = el.querySelectorAll('input[type="number"]')
    expect(nums.length).toBe(2)
    const intInput = Array.from(nums).find((n) => n.getAttribute('data-path') === 'max')
    expect(intInput!.getAttribute('step')).toBe('1')
  })

  test('REQ-R03: boolean -> checkbox', () => {
    const { el } = build(schema, {})
    expect(el.querySelector('input[type="checkbox"]')).toBeTruthy()
  })

  test('REQ-R04: nested object -> fieldset; root is flattened (no enclosing box)', () => {
    const { el } = build(schema, {})
    // root renders as a plain container, not a fieldset/legend box
    expect(el.querySelector('.form-root')).toBeTruthy()
    expect(el.querySelector('fieldset > legend')).toBeTruthy() // the `nested` object
    // the `nested` object IS a fieldset, and it is NOT wrapped in another fieldset
    const fs = el.querySelector('fieldset')
    expect(fs).toBeTruthy()
    expect(fs!.closest('fieldset')).toBe(fs) // no fieldset ancestor -> root flattened
  })

  test('REQ-R05: editing a field calls onChange(path, value)', () => {
    const { el, changes } = build(schema, {})
    const input = el.querySelector('input[data-path="key"]') as HTMLInputElement
    input.value = 'hello'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(changes).toContainEqual({ path: ['key'], value: 'hello' })
  })

  test('REQ-R06: error renders .field-error next to leaf control', () => {
    const { el } = build(schema, {}, [{ path: ['key'], message: 'is required' }])
    const err = el.querySelector('.field-error')
    expect(err).toBeTruthy()
    expect(err!.textContent).toContain('is required')
  })

  test('REQ-R06: error targeting an object node is also shown', () => {
    const { el } = build(schema, {}, [{ path: ['nested'], message: 'must be object' }])
    const errs = Array.from(el.querySelectorAll('.field-error')).map((e) => e.textContent)
    expect(errs).toContain('must be object')
  })

  test('REQ-R06: error targeting the root object is shown', () => {
    const { el } = build(schema, {}, [{ path: [], message: 'root is invalid' }])
    const errs = Array.from(el.querySelectorAll('.field-error')).map((e) => e.textContent)
    expect(errs).toContain('root is invalid')
  })

  test('REQ-R07: required label gets * marker', () => {
    const { el } = build(schema, {})
    const label = Array.from(el.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('key'),
    )
    expect(label!.textContent).toContain('*')
  })

  test('REQ-R08: description rendered', () => {
    const { el } = build(schema, {})
    expect(el.textContent).toContain('the key')
  })

  test('REQ-R16 (FIND-R7-002): a "/"-containing key routes its error to its OWN errbox', () => {
    const slashy = {
      type: 'object',
      properties: {
        'a/b': { type: 'string' },
        a: { type: 'object', properties: { b: { type: 'string' } } },
      },
    }
    const { el } = build(slashy, {})
    refreshErrors(el, [{ path: ['a/b'], message: 'top-level slashy error' }])
    // exactly one error, and it must NOT leak into the nested a.b field's box
    const errs = Array.from(el.querySelectorAll('.field-error')).map((e) => e.textContent)
    expect(errs).toEqual(['top-level slashy error'])
    // the nested ['a','b'] field's errbox must stay empty (no collision)
    const boxes = Array.from(el.querySelectorAll('.field-errbox'))
    const nestedBox = boxes.find((b) => b.getAttribute('data-errpath') === JSON.stringify(['a', 'b']))
    expect(nestedBox?.textContent).toBe('')
  })

  test('REQ-R16: refreshErrors updates errors without recreating input controls', () => {
    const { el } = build(schema, {})
    const keyInput = el.querySelector('input[data-path="key"]') as HTMLInputElement
    keyInput.value = 'typing…'
    // no error yet
    expect(el.querySelector('.field-error')).toBeNull()
    // add an error via refresh — the SAME input element must remain, value intact
    refreshErrors(el, [{ path: ['key'], message: 'bad key' }])
    const sameInput = el.querySelector('input[data-path="key"]') as HTMLInputElement
    expect(sameInput).toBe(keyInput) // identity preserved (no rebuild)
    expect(sameInput.value).toBe('typing…')
    expect(el.querySelector('.field-error')!.textContent).toContain('bad key')
    // clearing errors removes them, still same input
    refreshErrors(el, [])
    expect(el.querySelector('.field-error')).toBeNull()
    expect(el.querySelector('input[data-path="key"]')).toBe(keyInput)
  })

  const richSchema = {
    type: 'object',
    properties: {
      volume: { type: 'integer', minimum: 0, maximum: 100 },
      ratio: { type: 'number', minimum: 0, maximum: 1 },
      plain: { type: 'integer' }, // no min/max -> number input only
      note: { type: 'string', maxLength: 200 },
      short: { type: 'string', maxLength: 10 },
      on: { type: 'boolean' },
    },
  }

  test('REQ-R11: number with min+max -> range slider + synced number input', () => {
    const { el } = build(richSchema, { volume: 30 })
    const range = el.querySelector('input[type="range"][data-path="volume"]') as HTMLInputElement
    const num = el.querySelector('input[type="number"][data-path="volume"]') as HTMLInputElement
    expect(range).toBeTruthy()
    expect(num).toBeTruthy()
    expect(range.min).toBe('0')
    expect(range.max).toBe('100')
    expect(range.step).toBe('1') // integer
    expect(range.value).toBe('30')
    expect(num.value).toBe('30')
  })

  test('REQ-R11: plain number (no min/max) stays a single number input', () => {
    const { el } = build(richSchema, {})
    expect(el.querySelector('input[type="range"][data-path="plain"]')).toBeNull()
    expect(el.querySelector('input[type="number"][data-path="plain"]')).toBeTruthy()
  })

  test('REQ-R11/R14: moving the slider fires onChange and syncs the number box', () => {
    const { el, changes } = build(richSchema, { volume: 30 })
    const range = el.querySelector('input[type="range"][data-path="volume"]') as HTMLInputElement
    range.value = '70'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    expect(changes).toContainEqual({ path: ['volume'], value: 70 })
    const num = el.querySelector('input[type="number"][data-path="volume"]') as HTMLInputElement
    expect(num.value).toBe('70')
  })

  test('REQ-R12: long string (maxLength>=80) -> textarea; short -> text input', () => {
    const { el } = build(richSchema, {})
    expect(el.querySelector('textarea[data-path="note"]')).toBeTruthy()
    expect(el.querySelector('input[type="text"][data-path="short"]')).toBeTruthy()
    expect(el.querySelector('textarea[data-path="short"]')).toBeNull()
  })

  test('REQ-R12: editing the textarea fires onChange', () => {
    const { el, changes } = build(richSchema, {})
    const ta = el.querySelector('textarea[data-path="note"]') as HTMLTextAreaElement
    ta.value = 'hello world'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    expect(changes).toContainEqual({ path: ['note'], value: 'hello world' })
  })

  test('REQ-R13: boolean checkbox carries .toggle class (behavior unchanged)', () => {
    const { el } = build(richSchema, {})
    const cb = el.querySelector('input[type="checkbox"][data-path="on"]') as HTMLInputElement
    expect(cb.classList.contains('toggle')).toBe(true)
  })

  test('REQ-P10/R06: unsupported required child renders read-only + shows its error', () => {
    const refSchema = {
      type: 'object',
      required: ['sub'],
      properties: { sub: { $ref: '#/definitions/Sub' }, name: { type: 'string' } },
    }
    const { el } = build(refSchema, { name: 'x' }, [
      { path: ['sub'], message: 'missing required property "sub"' },
    ])
    // read-only placeholder present
    expect(el.querySelector('.field-unknown')).toBeTruthy()
    // its validation error has a render target (was invisible before R2 fix)
    const errs = Array.from(el.querySelectorAll('.field-error')).map((e) => e.textContent)
    expect(errs.some((t) => t?.includes('missing required property'))).toBe(true)
    // no editable control is offered for the unsupported field
    expect(el.querySelector('input[data-path="sub"]')).toBeNull()
    expect(el.querySelector('select[data-path="sub"]')).toBeNull()
    expect(el.querySelector('pre[data-path="sub"]')).toBeTruthy()
  })

  test('REQ-R09 (FIND-R4-001): error with no field target shows in .form-errors summary', () => {
    // "ghost" is required but not in properties -> no FieldNode is generated for it.
    const ghostSchema = {
      type: 'object',
      required: ['ghost'],
      properties: { visible: { type: 'string' } },
    }
    const { el } = build(ghostSchema, { visible: 'x' }, [
      { path: ['ghost'], message: 'missing required property "ghost"' },
    ])
    const summary = el.querySelector('.form-errors')
    expect(summary).toBeTruthy()
    expect(summary!.textContent).toContain('ghost')
    expect(summary!.textContent).toContain('missing required property')
  })

  test('REQ-R09: errors that DO have a field target are not duplicated in the summary', () => {
    const { el } = build(schema, {}, [{ path: ['key'], message: 'is required' }])
    // rendered next to the field, not in the orphan summary
    expect(el.querySelector('.form-errors')).toBeNull()
  })

  test('REQ-R17: every field label carries its dotted path (leaf + nested + object)', () => {
    const { el } = build(schema, {})
    const paths = Array.from(el.querySelectorAll('code.field-path')).map((c) => c.textContent)
    // leaf at root, nested leaf, and the nested object itself are all annotated
    expect(paths).toContain('.key')
    expect(paths).toContain('.nested')
    expect(paths).toContain('.nested.flag')
    // root is flattened (REQ-R04) -> no "." tag is emitted for it
    expect(paths).not.toContain('.')
    // the path tag lives inside the label, not replacing the field name
    const keyLabel = Array.from(el.querySelectorAll('label')).find((l) =>
      l.querySelector('.field-name')?.textContent?.includes('key'),
    )!
    expect(keyLabel.querySelector('code.field-path')?.textContent).toBe('.key')
  })

  test('REQ-R18: field-meta shows live value; dirty field gets before-value + reset', () => {
    const { el } = build(schema, { key: 'now', max: 3 })
    // baseline differs at .key (was 'orig') and .max (was 1); .max unchanged in `current`? make key dirty
    refreshFieldMeta(el, { key: 'orig', max: 3 }, { key: 'now', max: 3 }, () => {})
    const keyMeta = el.querySelector('.field-meta[data-metapath="[\\"key\\"]"]') as HTMLElement
    // live value chip always present
    expect(keyMeta.querySelector('.fv')?.textContent).toBe('= "now"')
    // dirty: before value + reset button, and the .field is marked
    expect(keyMeta.querySelector('.fv-was')?.textContent).toBe('was "orig"')
    expect(keyMeta.querySelector('.fv-reset')).toBeTruthy()
    expect(keyMeta.closest('.field')!.classList.contains('field-dirty')).toBe(true)
    // unchanged field: value chip only, no dirty decoration
    const maxMeta = el.querySelector('.field-meta[data-metapath="[\\"max\\"]"]') as HTMLElement
    expect(maxMeta.querySelector('.fv')?.textContent).toBe('= 3')
    expect(maxMeta.querySelector('.fv-was')).toBeNull()
    expect(maxMeta.closest('.field')!.classList.contains('field-dirty')).toBe(false)
  })

  test('REQ-R18: reset button fires onReset(path)', () => {
    const { el } = build(schema, { key: 'now' })
    const resets: string[][] = []
    refreshFieldMeta(el, { key: 'orig' }, { key: 'now' }, (p) => resets.push(p))
    const btn = el.querySelector('.field-meta[data-metapath="[\\"key\\"]"] .fv-reset') as HTMLButtonElement
    btn.click()
    expect(resets).toEqual([['key']])
  })

  test('REQ-R18: refreshFieldMeta is idempotent (clears stale dirty on re-run)', () => {
    const { el } = build(schema, { key: 'now' })
    refreshFieldMeta(el, { key: 'orig' }, { key: 'now' }, () => {})
    // now everything matches baseline -> dirty must clear
    refreshFieldMeta(el, { key: 'now' }, { key: 'now' }, () => {})
    const keyMeta = el.querySelector('.field-meta[data-metapath="[\\"key\\"]"]') as HTMLElement
    expect(keyMeta.querySelector('.fv-was')).toBeNull()
    expect(keyMeta.closest('.field')!.classList.contains('field-dirty')).toBe(false)
  })

  test('REQ-R08 (FIND-R3-002): unknown placeholder still shows author description', () => {
    const refSchema = {
      type: 'object',
      properties: { sub: { $ref: '#', description: 'the API host' } },
    }
    const { el } = build(refSchema, {})
    expect(el.querySelector('.field-unknown')).toBeTruthy()
    expect(el.textContent).toContain('the API host')
  })
})
