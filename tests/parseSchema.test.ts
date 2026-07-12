import { describe, test, expect } from 'vitest'
import { parseSchema } from '../src/core/parseSchema'
import type { ObjectField, NumberField, StringField, ArrayField } from '../src/core/types'

describe('spec:parser', () => {
  test('REQ-P01: non-object schema returns error', () => {
    expect(parseSchema(null).ok).toBe(false)
    expect(parseSchema(42).ok).toBe(false)
    expect(parseSchema([]).ok).toBe(false)
  })

  test('REQ-P02: missing or unsupported type returns error', () => {
    expect(parseSchema({}).ok).toBe(false)
    expect(parseSchema({ type: 'null' }).ok).toBe(false)
  })

  test('REQ-P03: object with properties recurses into children', () => {
    const r = parseSchema({
      type: 'object',
      properties: { max: { type: 'integer' }, key: { type: 'string' } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.root.kind).toBe('object')
    const root = r.root as ObjectField
    expect(root.children.map((c) => c.path.at(-1))).toEqual(['max', 'key'])
    expect(root.children[0]!.path).toEqual(['max'])
  })

  test('REQ-P04: required propagates to child', () => {
    const r = parseSchema({
      type: 'object',
      required: ['key'],
      properties: { max: { type: 'integer' }, key: { type: 'string' } },
    })
    if (!r.ok) throw new Error('expected ok')
    const root = r.root as ObjectField
    expect(root.children.find((c) => c.path.at(-1) === 'key')!.required).toBe(true)
    expect(root.children.find((c) => c.path.at(-1) === 'max')!.required).toBe(false)
  })

  test('REQ-P05: integer -> number kind with integer:true; number -> false', () => {
    const r = parseSchema({
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'number' } },
    })
    if (!r.ok) throw new Error('expected ok')
    const root = r.root as ObjectField
    const a = root.children[0] as NumberField
    const b = root.children[1] as NumberField
    expect(a.kind).toBe('number')
    expect(a.integer).toBe(true)
    expect(b.integer).toBe(false)
  })

  test('REQ-P06: label uses title, falls back to key name', () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        max: { type: 'integer', title: 'Maximum Value' },
        key: { type: 'string' },
      },
    })
    if (!r.ok) throw new Error('expected ok')
    const root = r.root as ObjectField
    expect(root.children.find((c) => c.path.at(-1) === 'max')!.label).toBe('Maximum Value')
    expect(root.children.find((c) => c.path.at(-1) === 'key')!.label).toBe('key')
  })

  test('REQ-P07: array with items recurses; missing items -> error', () => {
    const r = parseSchema({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    })
    if (!r.ok) throw new Error('expected ok')
    const arr = (r.root as ObjectField).children[0] as ArrayField
    expect(arr.kind).toBe('array')
    expect(arr.item.kind).toBe('string')
    expect(arr.item.path).toEqual(['tags', '[]'])

    expect(parseSchema({ type: 'array' }).ok).toBe(false)
  })

  test('REQ-P08: constraints copied to matching type; mismatched ignored', () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 10,
          pattern: '^[a-z]+$',
          minimum: 5, // mismatched -> ignored
          enum: ['a', 'b'],
          default: 'a',
          description: 'the name',
        },
        max: { type: 'integer', minimum: 0, maximum: 100 },
      },
    })
    if (!r.ok) throw new Error('expected ok')
    const root = r.root as ObjectField
    const name = root.children[0] as StringField
    expect(name.minLength).toBe(1)
    expect(name.maxLength).toBe(10)
    expect(name.pattern).toBe('^[a-z]+$')
    expect(name.enum).toEqual(['a', 'b'])
    expect(name.default).toBe('a')
    expect(name.description).toBe('the name')
    expect('minimum' in name).toBe(false)
    const max = root.children[1] as NumberField
    expect(max.minimum).toBe(0)
    expect(max.maximum).toBe(100)
  })

  test('REQ-P09: $ref self-reference terminates as unknown placeholder, siblings survive', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: { self: { $ref: '#' }, name: { type: 'string' } },
    }
    const r = parseSchema(schema)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const root = r.root as ObjectField
    expect(root.children.map((c) => c.path.at(-1))).toEqual(['self', 'name'])
    expect(root.children.find((c) => c.path.at(-1) === 'self')!.kind).toBe('unknown')
    expect(root.children.find((c) => c.path.at(-1) === 'name')!.kind).toBe('string')
  })

  test('REQ-P10: unsupported/missing-type child -> unknown placeholder, not fatal', () => {
    const r = parseSchema({
      type: 'object',
      required: ['weird'],
      properties: {
        good: { type: 'string' },
        weird: { type: 'null' }, // unsupported
        noType: { description: 'no type at all' }, // missing type
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const root = r.root as ObjectField
    expect(root.children.map((c) => c.path.at(-1))).toEqual(['good', 'weird', 'noType'])
    const weird = root.children.find((c) => c.path.at(-1) === 'weird')!
    expect(weird.kind).toBe('unknown')
    // required flag is preserved so a validator error has a render target.
    expect(weird.required).toBe(true)
    expect(root.children.find((c) => c.path.at(-1) === 'noType')!.kind).toBe('unknown')
  })

  test('REQ-P07: missing array items at ROOT is a hard error', () => {
    expect(parseSchema({ type: 'array' }).ok).toBe(false)
  })

  test('REQ-P10 note (FIND-R3-003): child array with bad/unsupported items -> unknown placeholder, not fatal', () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        tags: { type: 'array' }, // missing items
        refs: { type: 'array', items: { $ref: '#' } }, // unsupported items
        name: { type: 'string' },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const root = r.root as ObjectField
    expect(root.children.find((c) => c.path.at(-1) === 'tags')!.kind).toBe('unknown')
    expect(root.children.find((c) => c.path.at(-1) === 'refs')!.kind).toBe('unknown')
    expect(root.children.find((c) => c.path.at(-1) === 'name')!.kind).toBe('string')
  })

  test('REQ-P02: unsupported/missing type at ROOT is still a hard error', () => {
    expect(parseSchema({ type: 'null' }).ok).toBe(false)
    expect(parseSchema({ description: 'no type' }).ok).toBe(false)
  })
})
