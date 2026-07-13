import { describe, test, expect } from 'vitest'
import { inferSchema } from '../src/core/inferSchema'
import { parseSchema } from '../src/core/parseSchema'

describe('spec:schema-infer', () => {
  test('REQ-I01: object -> type object, properties, required empty', () => {
    const s = inferSchema({ a: 'x', b: 1 }) as Record<string, unknown>
    expect(s.type).toBe('object')
    expect(Object.keys(s.properties as object)).toEqual(['a', 'b'])
    expect(s.required).toEqual([])
  })

  test('REQ-I02: type inference per value', () => {
    const s = inferSchema({
      str: 'x',
      bool: true,
      int: 42,
      float: 3.5,
      arr: ['a', 'b'],
      obj: { n: 1 },
    }) as Record<string, unknown>
    const p = s.properties as Record<string, Record<string, unknown>>
    expect(p.str!.type).toBe('string')
    expect(p.bool!.type).toBe('boolean')
    expect(p.int!.type).toBe('integer')
    expect(p.float!.type).toBe('number')
    expect(p.arr!.type).toBe('array')
    expect((p.arr!.items as Record<string, unknown>).type).toBe('string')
    expect(p.obj!.type).toBe('object')
  })

  test('REQ-I03: leaf values carry examples: [value]', () => {
    const s = inferSchema({ key: 'abc', max: 20 }) as Record<string, unknown>
    const p = s.properties as Record<string, Record<string, unknown>>
    expect(p.key!.examples).toEqual(['abc'])
    expect(p.max!.examples).toEqual([20])
  })

  test('REQ-I04: empty array -> type array without items', () => {
    const s = inferSchema({ tags: [] }) as Record<string, unknown>
    const p = s.properties as Record<string, Record<string, unknown>>
    expect(p.tags!.type).toBe('array')
    expect('items' in p.tags!).toBe(false)
  })

  test('REQ-I05: null -> empty schema (no constraint)', () => {
    const s = inferSchema({ maybe: null }) as Record<string, unknown>
    const p = s.properties as Record<string, Record<string, unknown>>
    expect(p.maybe).toEqual({})
  })

  test('REQ-I06: input is not mutated', () => {
    const input = { a: 1, nested: { b: 2 } }
    inferSchema(input)
    expect(input).toEqual({ a: 1, nested: { b: 2 } })
  })

  test('REQ-I07 + round-trip: inferred schema parses cleanly and validates its source config', async () => {
    const config = { key: 'abc123', max: 20, mode: 'active', tel: { enabled: true } }
    const schema = inferSchema(config)
    // must be parseable by the renderer pipeline
    expect(parseSchema(schema).ok).toBe(true)
    // and the source config must validate against its own inferred schema
    const { validateConfig } = await import('../src/core/validateConfig')
    expect(validateConfig(schema, config).valid).toBe(true)
  })
})
