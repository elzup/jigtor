import { describe, test, expect } from 'vitest'
import {
  flattenSchema,
  editSchemaField,
  addSchemaField,
  removeSchemaField,
  sampleFromSchema,
} from '../src/core/schemaEdit'
import { validateConfig } from '../src/core/validateConfig'

const schema = () => ({
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 2, description: 'the key' },
    max: { type: 'integer', minimum: 0, maximum: 100, default: 20 },
    sub: {
      type: 'object',
      required: ['hoge'],
      properties: { hoge: { type: 'boolean' } },
    },
  },
})

describe('spec:schema-edit', () => {
  test('REQ-SE01/02/03: flatten to DFS rows with required + type-appropriate constraints', () => {
    const rows = flattenSchema(schema())
    expect(rows.map((r) => r.path.join('.'))).toEqual(['key', 'max', 'sub', 'sub.hoge'])
    const key = rows.find((r) => r.path.join('.') === 'key')!
    expect(key.type).toBe('string')
    expect(key.required).toBe(true)
    expect(key.minLength).toBe(2)
    expect(key.description).toBe('the key')
    const max = rows.find((r) => r.path.join('.') === 'max')!
    expect(max.type).toBe('integer')
    expect(max.required).toBe(false)
    expect(max.minimum).toBe(0)
    expect(max.default).toBe(20)
    const hoge = rows.find((r) => r.path.join('.') === 'sub.hoge')!
    expect(hoge.required).toBe(true) // from sub.required
  })

  test('REQ-SE04: editSchemaField merges patch immutably; undefined deletes', () => {
    const s0 = schema()
    const s1 = editSchemaField(s0, ['max'], { maximum: 50, default: undefined }) as Record<string, any>
    expect(s1.properties.max.maximum).toBe(50)
    expect('default' in s1.properties.max).toBe(false)
    // original untouched
    expect((s0 as any).properties.max.maximum).toBe(100)
    expect((s0 as any).properties.max.default).toBe(20)
  })

  test('REQ-SE04: required patch toggles the PARENT required[] at the field key', () => {
    const s0 = schema()
    // make `max` required
    const s1 = editSchemaField(s0, ['max'], { required: true }) as any
    expect(s1.required).toContain('max')
    // remove `key` from required
    const s2 = editSchemaField(s1, ['key'], { required: false }) as any
    expect(s2.required).not.toContain('key')
    // nested required toggles sub.required
    const s3 = editSchemaField(s0, ['sub', 'hoge'], { required: false }) as any
    expect(s3.properties.sub.required).not.toContain('hoge')
  })

  test('REQ-SE05: changing type strips incompatible constraints', () => {
    const s0 = schema()
    const s1 = editSchemaField(s0, ['key'], { type: 'integer' }) as any
    expect(s1.properties.key.type).toBe('integer')
    expect('minLength' in s1.properties.key).toBe(false) // string-only constraint removed
  })

  test('REQ-SE06: addSchemaField adds a property; no-op on duplicate/non-object', () => {
    const s0 = schema()
    const s1 = addSchemaField(s0, [], 'flag', 'boolean') as any
    expect(s1.properties.flag).toEqual({ type: 'boolean' })
    // nested add
    const s2 = addSchemaField(s0, ['sub'], 'note', 'string') as any
    expect(s2.properties.sub.properties.note).toEqual({ type: 'string' })
    // duplicate key -> unchanged
    expect(addSchemaField(s0, [], 'key', 'string')).toEqual(s0)
    // non-object parent -> unchanged
    expect(addSchemaField(s0, ['max'], 'x', 'string')).toEqual(s0)
  })

  test('REQ-SE07: removeSchemaField deletes property and its required entry', () => {
    const s0 = schema()
    const s1 = removeSchemaField(s0, ['key']) as any
    expect('key' in s1.properties).toBe(false)
    expect(s1.required).not.toContain('key')
    const s2 = removeSchemaField(s0, ['sub', 'hoge']) as any
    expect('hoge' in s2.properties.sub.properties).toBe(false)
    expect(s2.properties.sub.required).not.toContain('hoge')
  })

  test('REQ-SE08: edits keep the schema parseable and never throw', () => {
    const s0 = schema()
    expect(() => editSchemaField(s0, ['nope'], { type: 'string' })).not.toThrow()
  })

  test('REQ-SE09: sampleFromSchema builds a valid sample config', () => {
    const s0 = schema()
    const sample = sampleFromSchema(s0) as Record<string, unknown>
    expect(sample.max).toBe(20) // default wins
    expect(typeof sample.key).toBe('string')
    expect((sample.sub as Record<string, unknown>).hoge).toBe(false) // boolean placeholder
    // the generated sample validates against the schema (min/enum respected)
    expect(validateConfig(s0, sample).valid).toBe(true)
  })

  test('REQ-SE05: object->scalar type change strips properties & required', () => {
    const s0 = schema()
    const s1 = editSchemaField(s0, ['sub'], { type: 'string' }) as any
    expect(s1.properties.sub.type).toBe('string')
    expect('properties' in s1.properties.sub).toBe(false)
    expect('required' in s1.properties.sub).toBe(false)
  })

  test('REQ-SE09 (R10): sample stays valid when enum conflicts with sibling constraints', () => {
    const s = {
      type: 'object',
      properties: {
        n: { type: 'integer', enum: [3, 10], minimum: 5 }, // 3 < minimum -> must pick 10
        str: { type: 'string', enum: ['a', 'abcdef'], minLength: 3 }, // 'a' too short
      },
    }
    const sample = sampleFromSchema(s) as Record<string, unknown>
    expect(sample.n).toBe(10)
    expect(sample.str).toBe('abcdef')
    expect(validateConfig(s, sample).valid).toBe(true)
  })

  test('REQ-SE09 (R10): required key absent from properties is still present in the sample', () => {
    const s = { type: 'object', required: ['x'], properties: {} }
    const sample = sampleFromSchema(s) as Record<string, unknown>
    expect('x' in sample).toBe(true)
    expect(validateConfig(s, sample).valid).toBe(true)
    // nested variant
    const nested = { type: 'object', properties: { o: { type: 'object', required: ['y'], properties: {} } } }
    expect(validateConfig(nested, sampleFromSchema(nested)).valid).toBe(true)
  })

  test('REQ-SE09 (R10): array minItems produces enough sample items', () => {
    const s = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 2 } } }
    const sample = sampleFromSchema(s) as Record<string, unknown>
    expect((sample.tags as unknown[]).length).toBe(2)
    expect(validateConfig(s, sample).valid).toBe(true)
  })

  test('REQ-SE09: sample respects enum and minimum', () => {
    const s = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['a', 'b'] },
        n: { type: 'integer', minimum: 5 },
      },
    }
    const sample = sampleFromSchema(s) as Record<string, unknown>
    expect(sample.mode).toBe('a') // enum[0]
    expect(sample.n).toBe(5) // minimum, since placeholder 0 < minimum
    expect(validateConfig(s, sample).valid).toBe(true)
  })
})
