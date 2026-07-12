import { describe, test, expect } from 'vitest'
import { validateConfig } from '../src/core/validateConfig'

const schema = {
  type: 'object',
  required: ['key'],
  properties: {
    max: { type: 'integer', minimum: 0, maximum: 100 },
    key: { type: 'string', minLength: 1 },
    nested: {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
    },
  },
}

describe('spec:validator', () => {
  test('REQ-V01: valid config -> valid:true, no errors', () => {
    const r = validateConfig(schema, { max: 20, key: 'abc' })
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  test('REQ-V02: constraint violation -> valid:false with an error', () => {
    const r = validateConfig(schema, { max: 999, key: 'abc' })
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThanOrEqual(1)
  })

  test('REQ-V03: instancePath normalized to path array', () => {
    const r = validateConfig(schema, { max: 999, key: 'abc' })
    const err = r.errors.find((e) => e.path.at(-1) === 'max')
    expect(err).toBeDefined()
    expect(err!.path).toEqual(['max'])
  })

  test('REQ-V03: nested instancePath -> nested path array', () => {
    const r = validateConfig(schema, { key: 'abc', nested: { flag: 'notbool' } })
    const err = r.errors.find((e) => e.path.join('/') === 'nested/flag')
    expect(err).toBeDefined()
    expect(err!.path).toEqual(['nested', 'flag'])
  })

  test('REQ-V04: missing required -> path points at the missing key itself', () => {
    const r = validateConfig(schema, { max: 20 })
    const err = r.errors.find((e) => e.path.at(-1) === 'key')
    expect(err).toBeDefined()
    expect(err!.path).toEqual(['key'])
  })

  test('REQ-V04: nested missing required -> [...parent, missingKey]', () => {
    const nestedSchema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          required: ['flag'],
          properties: { flag: { type: 'boolean' } },
        },
      },
    }
    const r = validateConfig(nestedSchema, { nested: {} })
    const err = r.errors.find((e) => e.path.at(-1) === 'flag')
    expect(err).toBeDefined()
    expect(err!.path).toEqual(['nested', 'flag'])
  })

  test('REQ-V06 regression (FIND-R3-001): $ref inside draft-07 "dependencies" does not fail closed', () => {
    const depSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      dependencies: { a: { $ref: '#/definitions/Nope' } },
    }
    // Unresolvable $ref nested in `dependencies` must be stripped, not thrown.
    const r = validateConfig(depSchema, { a: 'x' })
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
    // property-dependency (array) form must also survive and still enforce.
    const propDep = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      dependencies: { a: ['b'] },
    }
    expect(validateConfig(propDep, { a: 'x' }).valid).toBe(false) // b required when a present
    expect(validateConfig(propDep, { a: 'x', b: 1 }).valid).toBe(true)
  })

  test('REQ-V06 regression (FIND-R2-001): a property literally named "$ref" is still enforced', () => {
    const schema$ref = {
      type: 'object',
      required: ['$ref'],
      properties: { $ref: { type: 'string', minLength: 3 } },
    }
    // Must NOT be stripped away: an invalid value has to be caught.
    expect(validateConfig(schema$ref, { $ref: 123 }).valid).toBe(false)
    expect(validateConfig(schema$ref, { $ref: 'ab' }).valid).toBe(false) // too short
    expect(validateConfig(schema$ref, { $ref: 'abc' }).valid).toBe(true)
  })

  test('REQ-V05: uncompilable schema -> no throw, error at root path', () => {
    const bad = { type: 'object', properties: { a: { minimum: 'not-a-number' } } }
    let r: ReturnType<typeof validateConfig>
    expect(() => {
      r = validateConfig(bad, { a: 1 })
    }).not.toThrow()
    r = validateConfig(bad, { a: 1 })
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.path).toEqual([])
  })

  test('REQ-V06: unknown keywords ($ref) do not throw AND do not fail a valid config', () => {
    const withRef = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' }, b: { $ref: '#/definitions/x' } },
    }
    expect(() => validateConfig(withRef, { a: 'x', b: { anything: 1 } })).not.toThrow()
    // A config satisfying the supported subset must be reported valid even though
    // the schema contains an unresolvable $ref (which ajv cannot compile as-is).
    const r = validateConfig(withRef, { a: 'x', b: { anything: 1 } })
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
    // The supported field is still enforced.
    expect(validateConfig(withRef, { a: 123 }).valid).toBe(false)
  })

  test('REQ-V06: self-referential $ref does not throw and still validates subset', () => {
    const recursive = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, child: { $ref: '#' } },
    }
    const r = validateConfig(recursive, { name: 'root', child: { name: 'kid' } })
    expect(r.valid).toBe(true)
  })
})
