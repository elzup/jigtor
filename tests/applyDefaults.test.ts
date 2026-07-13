import { describe, test, expect } from 'vitest'
import { applyDefaults } from '../src/core/applyDefaults'
import { parseSchema } from '../src/core/parseSchema'

function build(schema: unknown, config: unknown) {
  const r = parseSchema(schema)
  if (!r.ok) throw new Error(r.error)
  return applyDefaults(r.root, config)
}

describe('spec:defaults', () => {
  test('REQ-D01: missing field with default is filled', () => {
    const schema = { type: 'object', properties: { max: { type: 'integer', default: 20 } } }
    expect(build(schema, {})).toEqual({ max: 20 })
  })

  test('REQ-D02: falls back to example when no default; default wins over example', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', example: 'ex' },
        b: { type: 'string', default: 'def', example: 'ex' },
      },
    }
    expect(build(schema, {})).toEqual({ a: 'ex', b: 'def' })
  })

  test('REQ-D02: examples[0] is used as example', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', examples: ['first', 'second'] } } }
    expect(build(schema, {})).toEqual({ a: 'first' })
  })

  test('REQ-D03: existing values (incl. falsy) are not overwritten', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'integer', default: 20 },
        s: { type: 'string', default: 'x' },
        b: { type: 'boolean', default: true },
      },
    }
    expect(build(schema, { n: 0, s: '', b: false })).toEqual({ n: 0, s: '', b: false })
  })

  test('REQ-D04: nested object defaults fill through intermediate objects', () => {
    const schema = {
      type: 'object',
      properties: {
        tel: { type: 'object', properties: { enabled: { type: 'boolean', default: true } } },
      },
    }
    expect(build(schema, {})).toEqual({ tel: { enabled: true } })
  })

  test('REQ-D04: no phantom empty objects when a subtree has nothing to fill', () => {
    const schema = {
      type: 'object',
      properties: {
        tel: { type: 'object', properties: { enabled: { type: 'boolean' } } }, // no default
        keep: { type: 'string', default: 'k' },
      },
    }
    // `tel` has no default anywhere -> must NOT be created.
    expect(build(schema, {})).toEqual({ keep: 'k' })
  })

  test('REQ-D03/R5-001: a present non-object at an object-typed field is preserved, not clobbered', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'object', properties: { b: { type: 'string', default: 'x' } } },
      },
    }
    // scalar / array / null present where schema expects an object: keep as-is.
    expect(build(schema, { a: 'oops-existing-string' })).toEqual({ a: 'oops-existing-string' })
    expect(build(schema, { a: [1, 2, 3] })).toEqual({ a: [1, 2, 3] })
    expect(build(schema, { a: null })).toEqual({ a: null })
    // and when genuinely missing, it still fills.
    expect(build(schema, {})).toEqual({ a: { b: 'x' } })
  })

  test('REQ-D05: input config is not mutated', () => {
    const schema = { type: 'object', properties: { max: { type: 'integer', default: 20 } } }
    const input = {}
    build(schema, input)
    expect(input).toEqual({})
  })

  test('REQ-D06: schema-external fields are preserved', () => {
    const schema = { type: 'object', properties: { max: { type: 'integer', default: 20 } } }
    expect(build(schema, { legacy: 'keep-me' })).toEqual({ legacy: 'keep-me', max: 20 })
  })

  test('REQ-D07: array/unknown fields are not defaulted', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        ref: { $ref: '#' },
      },
    }
    expect(build(schema, {})).toEqual({})
  })
})
