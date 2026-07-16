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

  test('REQ-R02/R19: number/integer -> number input, with no native step/min/max', () => {
    const { el } = build(schema, {})
    const nums = el.querySelectorAll('input[type="number"]')
    expect(nums.length).toBe(2)
    const intInput = Array.from(nums).find((n) => n.getAttribute('data-path') === 'max')!
    // REQ-R19: integers no longer carry step=1 — input is unconstrained, ajv warns
    expect(intInput.hasAttribute('step')).toBe(false)
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

  test('REQ-R18: field-meta shows a live "key": value line; dirty field shows the before→after transition + reset', () => {
    const { el } = build(schema, { key: 'now', max: 3 })
    refreshFieldMeta(el, { key: 'orig', max: 3 }, { key: 'now', max: 3 }, () => {})
    const keyMeta = el.querySelector('.field-meta[data-metapath="[\\"key\\"]"]') as HTMLElement
    // changed: before line (struck) + "→ after" line, and the .field is marked
    expect(keyMeta.querySelector('.fv-before')?.textContent).toBe('"key": "orig"')
    expect(keyMeta.querySelector('.fv-after')?.textContent).toBe('→ "key": "now"')
    expect(keyMeta.querySelector('.fv-reset')).toBeTruthy()
    expect(keyMeta.closest('.field')!.classList.contains('field-dirty')).toBe(true)
    // unchanged field: single live "key": value line, no dirty decoration
    const maxMeta = el.querySelector('.field-meta[data-metapath="[\\"max\\"]"]') as HTMLElement
    expect(maxMeta.querySelector('.fv')?.textContent).toBe('"max": 3')
    expect(maxMeta.querySelector('.fv-before')).toBeNull()
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
    expect(keyMeta.querySelector('.fv-before')).toBeNull()
    expect(keyMeta.querySelector('.fv-after')).toBeNull()
    expect(keyMeta.closest('.field')!.classList.contains('field-dirty')).toBe(false)
  })

  test('REQ-R19: inputs carry no native constraint attributes (validation is ajv-only)', () => {
    const constrained = {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 5, pattern: '^[a-z]+$' },
        bio: { type: 'string', maxLength: 120 }, // -> textarea
        count: { type: 'integer', minimum: 1, maximum: 10 }, // -> slider pair
        loose: { type: 'number' }, // -> plain number
      },
    }
    const { el } = build(constrained, {})
    const name = el.querySelector('input[type="text"][data-path="name"]') as HTMLInputElement
    expect(name.hasAttribute('maxlength')).toBe(false)
    expect(name.hasAttribute('pattern')).toBe(false)
    const bio = el.querySelector('textarea[data-path="bio"]') as HTMLTextAreaElement
    expect(bio.hasAttribute('maxlength')).toBe(false)
    // slider's paired number input is unconstrained; the range keeps its bounds
    const num = el.querySelector('input[type="number"][data-path="count"]') as HTMLInputElement
    expect(num.hasAttribute('min')).toBe(false)
    expect(num.hasAttribute('max')).toBe(false)
    expect(num.hasAttribute('step')).toBe(false)
    const loose = el.querySelector('input[type="number"][data-path="loose"]') as HTMLInputElement
    expect(loose.hasAttribute('min')).toBe(false)
    expect(loose.hasAttribute('step')).toBe(false)
  })

  describe('REQ-R20: array (list) editing', () => {
    const listSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        rules: { type: 'array', items: { type: 'object', properties: { p: { type: 'string' } } } },
      },
    }

    test('primitive item array -> one input row per item + add control', () => {
      const { el } = build(listSchema, { tags: ['a', 'b'] })
      const editor = el.querySelector('.field-array-editor[data-path="tags"]')!
      const rows = editor.querySelectorAll('.array-row')
      expect(rows).toHaveLength(2)
      expect((rows[0]!.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('a')
      expect(editor.querySelector('.array-add')).toBeTruthy()
    })

    test('editing an item value fires onChange with the whole updated array (no row rebuild)', () => {
      const { el, changes } = build(listSchema, { tags: ['a', 'b'] })
      const input = el.querySelector('.array-row input[type="text"]') as HTMLInputElement
      input.value = 'z'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(changes).toContainEqual({ path: ['tags'], value: ['z', 'b'] })
    })

    test('add appends a typed default; remove drops the item; both emit', () => {
      const { el, changes } = build(listSchema, { tags: ['a'] })
      ;(el.querySelector('.array-add') as HTMLButtonElement).click()
      expect(changes.at(-1)).toEqual({ path: ['tags'], value: ['a', ''] })
      // now two rows; remove the first
      const rms = el.querySelectorAll('.array-row .array-rm')
      ;(rms[0] as HTMLButtonElement).click()
      expect(changes.at(-1)).toEqual({ path: ['tags'], value: [''] })
    })

    test('reorder moves an item up', () => {
      const { el, changes } = build(listSchema, { tags: ['a', 'b', 'c'] })
      const downFirst = el.querySelectorAll('.array-row')[0]!.querySelectorAll('.array-btn')
      // buttons order: [up, down, remove]; click "down" on index 0
      ;(downFirst[1] as HTMLButtonElement).click()
      expect(changes.at(-1)).toEqual({ path: ['tags'], value: ['b', 'a', 'c'] })
    })

    test('object item array -> a collapsible subform per item (details), no JSON textarea', () => {
      const { el } = build(listSchema, { rules: [{ p: 'x' }, { p: 'y' }] })
      const editor = el.querySelector('.field-array-editor[data-path="rules"]')!
      const items = editor.querySelectorAll('details.array-item.subform')
      expect(items).toHaveLength(2)
      // collapsible with an index summary, and each child field rendered as an input
      expect(items[0]!.querySelector('summary .array-index')?.textContent).toBe('#0')
      const firstInput = items[0]!.querySelector('.subform-row input[type="text"]') as HTMLInputElement
      expect(firstInput.value).toBe('x')
      // no whole-array JSON textarea fallback anymore
      expect(el.querySelector('textarea.array-json')).toBeNull()
    })

    test('editing a subform field emits the whole array with that item updated', () => {
      const { el, changes } = build(listSchema, { rules: [{ p: 'x' }] })
      const input = el.querySelector(
        'details.array-item .subform-row input[type="text"]',
      ) as HTMLInputElement
      input.value = 'y'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(changes).toContainEqual({ path: ['rules'], value: [{ p: 'y' }] })
    })

    test('object array add seeds required children; two fields compose without clobbering', () => {
      const twoField = {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path'],
              properties: { path: { type: 'string' }, allow: { type: 'boolean' } },
            },
          },
        },
      }
      const { el, changes } = build(twoField, { rules: [] })
      ;(el.querySelector('.array-add') as HTMLButtonElement).click()
      // required primitive child seeded
      expect(changes.at(-1)).toEqual({ path: ['rules'], value: [{ path: '' }] })
      // edit BOTH fields of the item; the second edit must not clobber the first
      const item = el.querySelector('details.array-item')!
      const pathInput = item.querySelector('input[type="text"]') as HTMLInputElement
      pathInput.value = '/api'
      pathInput.dispatchEvent(new Event('input', { bubbles: true }))
      const allow = item.querySelector('input[type="checkbox"]') as HTMLInputElement
      allow.checked = true
      allow.dispatchEvent(new Event('change', { bubbles: true }))
      expect(changes.at(-1)).toEqual({ path: ['rules'], value: [{ path: '/api', allow: true }] })
    })

    // R20-testslop (adversary R14): lock the recursion-depth paths that were only
    // manually verified — deep nest, reorder-then-re-edit, nested array, array-of-array.
    const rowInput = (root: Element, name: string): HTMLInputElement => {
      const row = Array.from(root.querySelectorAll('.subform-row')).find(
        (r) => r.querySelector(':scope > .field-name')?.textContent === name,
      )!
      return row.querySelector('input') as HTMLInputElement
    }
    const fire = (el: HTMLElement, type = 'input') =>
      el.dispatchEvent(new Event(type, { bubbles: true }))

    test('deep nest (object-in-object-in-array): interleaved edits drop nothing', () => {
      const deep = {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                a: { type: 'string' },
                sub: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' } } },
              },
            },
          },
        },
      }
      const { el, changes } = build(deep, { groups: [{ a: 'A', sub: { x: 'X', y: 'Y' } }] })
      const grp = el.querySelector('details.array-item') as HTMLElement
      const y = rowInput(grp, 'y')
      y.value = 'Y2'
      fire(y)
      const a = rowInput(grp, 'a')
      a.value = 'A2'
      fire(a)
      const x = rowInput(grp, 'x')
      x.value = 'X2'
      fire(x)
      expect(changes.at(-1)).toEqual({
        path: ['groups'],
        value: [{ a: 'A2', sub: { x: 'X2', y: 'Y2' } }],
      })
    })

    test('edit -> reorder OTHER item -> edit again writes the correct indices', () => {
      const { el, changes } = build(listSchema, { rules: [{ p: 'a' }, { p: 'b' }, { p: 'c' }] })
      const item0 = () => el.querySelectorAll('details.array-item')[0] as HTMLElement
      const p0 = item0().querySelector('input[type="text"]') as HTMLInputElement
      p0.value = 'A'
      fire(p0)
      // move item0 down (swap 0<->1): order becomes [b, A, c], rows redraw
      ;(item0().querySelector('.array-tools .array-btn:nth-child(2)') as HTMLButtonElement).click()
      // now edit the NEW index0 (which is 'b')
      const np0 = item0().querySelector('input[type="text"]') as HTMLInputElement
      np0.value = 'B'
      fire(np0)
      expect(changes.at(-1)).toEqual({ path: ['rules'], value: [{ p: 'B' }, { p: 'A' }, { p: 'c' }] })
    })

    test('nested array inside an object item emits the whole outer array', () => {
      const nested = {
        type: 'object',
        properties: {
          groups: {
            type: 'array',
            items: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
          },
        },
      }
      const { el, changes } = build(nested, { groups: [{ tags: ['x'] }] })
      const grp = el.querySelector('details.array-item') as HTMLElement
      const innerAdd = grp.querySelector('.field-array-editor .array-add') as HTMLButtonElement
      innerAdd.click()
      expect(changes.at(-1)).toEqual({ path: ['groups'], value: [{ tags: ['x', ''] }] })
    })

    test('array-of-array: outer reorder uses the outer controls and emits the whole outer array', () => {
      const matrix = {
        type: 'object',
        properties: { m: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
      }
      const { el, changes } = build(matrix, { m: [['a'], ['b']] })
      const outerRow0 = el.querySelector('.field-array-editor[data-path="m"] > .array-rows > .array-row')!
      // outer controls are the direct-child buttons (nested editor has its own)
      const down = outerRow0.querySelector(':scope > .array-btn:nth-of-type(2)') as HTMLButtonElement
      down.click()
      expect(changes.at(-1)).toEqual({ path: ['m'], value: [['b'], ['a']] })
    })

    test('FIND-A2: clearing a number item emits 0, never undefined/null into the array', () => {
      const numSchema = {
        type: 'object',
        properties: { nums: { type: 'array', items: { type: 'number' } } },
      }
      const { el, changes } = build(numSchema, { nums: [1, 2, 3] })
      const input = el.querySelectorAll('.array-row input[type="number"]')[1] as HTMLInputElement
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(changes.at(-1)).toEqual({ path: ['nums'], value: [1, 0, 3] })
      // and it survives JSON serialization with no null hole
      expect(JSON.stringify(changes.at(-1)!.value)).toBe('[1,0,3]')
      // a forced non-numeric value (jsdom only) still yields 0, never NaN->null
      input.value = 'abc'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(JSON.stringify(changes.at(-1)!.value)).toBe('[1,0,3]')
    })
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

// Block-mode overlay parity with the Tree: the schema form follows the config's
// own field order, surfaces schema-external keys, marks missing schema fields,
// and hints when the order drifts from the schema.
describe('spec:renderer Block overlay parity (schema-external / missing / order)', () => {
  const ovSchema = {
    type: 'object',
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
      c: { type: 'string' },
    },
  }
  function buildMove(schema: unknown, value: unknown) {
    const r = parseSchema(schema)
    if (!r.ok) throw new Error('bad schema: ' + r.error)
    const moves: Array<{ path: string[]; delta: number }> = []
    const el = renderForm(
      r.root,
      value,
      [],
      () => {},
      (path, delta) => moves.push({ path, delta }),
    )
    return { el, moves }
  }

  test('renders present fields in the config’s key order, not the schema order', () => {
    const { el } = build(ovSchema, { c: '3', a: '1' }) // config order: c, a
    const labels = [...el.querySelectorAll('label .field-name')].map((n) =>
      (n.textContent ?? '').replace(' *', ''),
    )
    // c before a (config order); b appended last as the missing field
    expect(labels).toEqual(['c', 'a', 'b'])
  })

  test('a schema-external key renders as a badged raw-JSON field', () => {
    const { el } = build(ovSchema, { a: '1', extra: { deep: true } })
    const external = el.querySelector('.field.field-external')
    expect(external).toBeTruthy()
    expect(external?.querySelector('.field-badge--ext')?.textContent).toBe('not in schema')
    expect(external?.textContent).toContain('extra')
  })

  test('a schema field the config omits is appended and marked not-set', () => {
    const { el } = build(ovSchema, { a: '1', b: '2' }) // c omitted
    const notSet = el.querySelector('.field.field-not-set')
    expect(notSet).toBeTruthy()
    expect(notSet?.querySelector('label .field-name')?.textContent?.replace(' *', '')).toBe('c')
  })

  test('order drift raises the distinct order badge; matching order does not', () => {
    const drift = build(ovSchema, { b: '2', a: '1', c: '3' }) // b before a
    expect(drift.el.querySelector('.field-badge--order')).toBeTruthy()
    const ordered = build(ovSchema, { a: '1', b: '2', c: '3' })
    expect(ordered.el.querySelector('.field-badge--order')).toBeNull()
  })

  test('with onMove, each present + missing field gets ↑↓ controls emitting its path', () => {
    const { el, moves } = buildMove(ovSchema, { a: '1', b: '2' })
    const controls = el.querySelectorAll('.form-move')
    // a, b (present) + c (missing) = 3 movable rows
    expect(controls.length).toBe(3)
    const firstUp = el.querySelector('.form-move .form-move-btn') as HTMLButtonElement
    firstUp.click()
    expect(moves.at(-1)).toEqual({ path: ['a'], delta: -1 })
  })
})
