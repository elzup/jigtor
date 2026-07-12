// Phase 5 (VSDD harden) — property-based invariants over generated inputs.
import { describe, test, expect } from 'vitest'
import fc from 'fast-check'
import { parseSchema } from '../src/core/parseSchema'
import { validateConfig } from '../src/core/validateConfig'
import { parseJsonFile, serializeConfig } from '../src/core/fileIo'

// Arbitrary JSON values (bounded depth) for round-trip / no-throw properties.
const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.array(tie('node'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('node'), { maxKeys: 4 }),
  ),
})).node

describe('file-io properties', () => {
  test('PROP-F01: serialize -> parse round-trips any JSON value (REQ-F04)', () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        const round = parseJsonFile(serializeConfig(value))
        expect(round.ok).toBe(true)
        if (round.ok) expect(round.value).toEqual(value)
      }),
    )
  })

  test('PROP-F02: parseJsonFile never throws on arbitrary text (REQ-F02)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => parseJsonFile(text)).not.toThrow()
      }),
    )
  })
})

describe('parser/validator meta-properties', () => {
  // Generator for schemas within the V1 subset.
  const leafSchema: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
    fc.record({ type: fc.constant('string') }),
    fc.record({ type: fc.constant('integer') }),
    fc.record({ type: fc.constant('number') }),
    fc.record({ type: fc.constant('boolean') }),
  )
  const objectSchema = fc
    .dictionary(fc.string({ minLength: 1, maxLength: 6 }), leafSchema, { maxKeys: 5 })
    .map((properties) => ({ type: 'object', properties }))

  test('PROP-P01: parseSchema never throws & returns a boolean ok', () => {
    fc.assert(
      fc.property(objectSchema, (schema) => {
        const r = parseSchema(schema)
        expect(typeof r.ok).toBe('boolean')
      }),
    )
  })

  test('PROP-P02: every parsed child path descends from its parent (REQ design:schema-model)', () => {
    fc.assert(
      fc.property(objectSchema, (schema) => {
        const r = parseSchema(schema)
        if (!r.ok || r.root.kind !== 'object') return
        for (const child of r.root.children) {
          expect(child.path.length).toBe(1)
          expect(schema.properties as object).toHaveProperty(child.path[0]!)
        }
      }),
    )
  })

  // Each run compiles a fresh Ajv instance; keep run counts modest so the
  // suite stays fast while still exercising a wide input space.
  const AJV_RUNS = { numRuns: 40 }

  test('PROP-V01: validateConfig never throws for any subset schema + any config', () => {
    fc.assert(
      fc.property(objectSchema, jsonValue, (schema, config) => {
        expect(() => validateConfig(schema, config)).not.toThrow()
      }),
      AJV_RUNS,
    )
  })

  test('PROP-V02: a required string property is enforced regardless of its NAME (locks FIND-R2-001)', () => {
    // stripRefs must never remove a property just because it is named like a
    // reference keyword. For any property name, a wrong-typed value is invalid.
    const trickyNames = fc.oneof(
      fc.constantFrom('$ref', '$dynamicRef', '$recursiveRef', 'properties', 'items'),
      fc.string({ minLength: 1, maxLength: 8 }),
    )
    fc.assert(
      fc.property(trickyNames, (name) => {
        const schema = {
          type: 'object',
          required: [name],
          properties: { [name]: { type: 'string', minLength: 2 } },
        }
        expect(validateConfig(schema, { [name]: 123 }).valid).toBe(false) // wrong type
        expect(validateConfig(schema, {}).valid).toBe(false) // missing required
        expect(validateConfig(schema, { [name]: 'ok' }).valid).toBe(true)
      }),
      AJV_RUNS,
    )
  })
})
