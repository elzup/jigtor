// Phase 5 (VSDD harden) — property-based invariants over generated inputs.
import { describe, test, expect } from 'vitest'
import fc from 'fast-check'
import { parseSchema } from '../src/core/parseSchema'
import { validateConfig } from '../src/core/validateConfig'
import { parseJsonFile, serializeConfig } from '../src/core/fileIo'
import { inferSchema } from '../src/core/inferSchema'
import { applyDefaults } from '../src/core/applyDefaults'
import { diffConfig, type Change } from '../src/core/diffConfig'
import {
  editSchemaField,
  addSchemaField,
  removeSchemaField,
  sampleFromSchema,
} from '../src/core/schemaEdit'

// Object keys: exclude __proto__/constructor/prototype — assigning those via a
// generated object mangles the prototype instead of creating a normal config
// key, which is a JS engine quirk, not jigtor behavior.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const safeKey = fc.string({ minLength: 1, maxLength: 6 }).filter((k) => !UNSAFE_KEYS.has(k))

// Arbitrary JSON values (bounded depth) for round-trip / no-throw properties.
const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    // JSON has no signed zero (JSON.stringify(-0)==="0"), so -0 never survives a
    // JSON round-trip. Normalize to +0 to keep these properties honest (not a bug).
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((x) => (x === 0 ? 0 : x)),
    fc.string(),
    fc.array(tie('node'), { maxLength: 4 }),
    fc.dictionary(safeKey, tie('node'), { maxKeys: 4 }),
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

describe('schema-infer / defaults meta-properties', () => {
  // Config objects: plain-object roots of bounded-depth JSON (the app's domain).
  const jsonLeaf = fc.oneof(
    fc.string(),
    fc.integer(),
    // JSON has no signed zero (JSON.stringify(-0)==="0"), so -0 never survives a
    // JSON round-trip. Normalize to +0 to keep these properties honest (not a bug).
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((x) => (x === 0 ? 0 : x)),
    fc.boolean(),
    fc.constant(null),
  )
  const objectConfig = fc.letrec((tie) => ({
    node: fc.dictionary(
      safeKey,
      fc.oneof({ depthSize: 'small' }, jsonLeaf, fc.array(jsonLeaf, { maxLength: 3 }), tie('node')),
      { maxKeys: 5 },
    ),
  })).node

  test('PROP-I01: inferred schema always parses and validates its source config', () => {
    fc.assert(
      fc.property(objectConfig, (config) => {
        const schema = inferSchema(config)
        expect(parseSchema(schema).ok).toBe(true)
        expect(validateConfig(schema, config).valid).toBe(true)
      }),
      { numRuns: 40 },
    )
  })

  test('PROP-I02: inferSchema does not mutate its input', () => {
    fc.assert(
      fc.property(objectConfig, (config) => {
        const snapshot = JSON.parse(JSON.stringify(config))
        inferSchema(config)
        expect(config).toEqual(snapshot)
      }),
    )
  })

  test('PROP-D01: applyDefaults never overwrites an existing value & is idempotent', () => {
    fc.assert(
      fc.property(objectConfig, (config) => {
        const schema = inferSchema(config)
        const parsed = parseSchema(schema)
        if (!parsed.ok) return
        const once = applyDefaults(parsed.root, config)
        // inferred schema has no `default`, so applyDefaults is a no-op here and
        // must preserve the config exactly (also covers no-overwrite).
        expect(once).toEqual(config)
        const twice = applyDefaults(parsed.root, once)
        expect(twice).toEqual(once) // idempotent
      }),
      { numRuns: 40 },
    )
  })

  test('PROP-D03: a present value at an object-typed field is NEVER altered (any type)', () => {
    // Fixed schema whose `a` is object-typed with a defaulted child. Feed ANY
    // value at `a` (incl. scalar/array/null mismatches) — it must be preserved.
    const schema = {
      type: 'object',
      properties: { a: { type: 'object', properties: { b: { type: 'string', default: 'x' } } } },
    }
    const parsed = parseSchema(schema)
    if (!parsed.ok) throw new Error('bad')
    fc.assert(
      fc.property(jsonLeaf, fc.array(jsonLeaf, { maxLength: 3 }), (leaf, arr) => {
        for (const present of [leaf, arr, {}, { b: 'kept' }, { extra: 1 }]) {
          const out = applyDefaults(parsed.root, { a: present }) as Record<string, unknown>
          if (typeof present === 'object' && present !== null && !Array.isArray(present)) {
            // object present: preserved, plus default filled if b missing
            expect(out.a).toEqual({ b: (present as Record<string, unknown>).b ?? 'x', ...present })
          } else {
            expect(out.a).toEqual(present) // scalar/array/null: untouched
          }
        }
      }),
    )
  })

  test('PROP-CL01: applying diffConfig(before,after) to before reconstructs after', () => {
    // Apply a change list onto a deep clone of `before`, then compare to `after`.
    const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
    const applyChange = (root: Record<string, unknown>, c: Change) => {
      let node = root
      for (const key of c.path.slice(0, -1)) {
        if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) {
          node[key] = {}
        }
        node = node[key] as Record<string, unknown>
      }
      const last = c.path.at(-1)!
      if (c.kind === 'removed') delete node[last]
      else node[last] = c.after
    }
    fc.assert(
      fc.property(objectConfig, objectConfig, (before, after) => {
        const changes = diffConfig(before, after)
        const rebuilt = (clone(before) ?? {}) as Record<string, unknown>
        for (const c of changes) applyChange(rebuilt, c)
        expect(rebuilt).toEqual(after)
      }),
    )
  })

  test('PROP-SE01: schema-edit ops never mutate the input schema & keep it parseable', () => {
    fc.assert(
      fc.property(objectConfig, (config) => {
        const schema = inferSchema(config)
        const snapshot = JSON.parse(JSON.stringify(schema))
        editSchemaField(schema, ['nope'], { type: 'string' })
        addSchemaField(schema, [], 'newField', 'boolean')
        removeSchemaField(schema, ['whatever'])
        expect(schema).toEqual(snapshot) // no mutation of input
        // an added field yields a still-parseable schema
        const added = addSchemaField(schema, [], 'zzz', 'string')
        expect(parseSchema(added).ok).toBe(true)
      }),
      { numRuns: 40 },
    )
  })

  test('PROP-SE02: sampleFromSchema output validates even for CONSTRAINED schemas', () => {
    // Hand-built schemas carrying the constraint classes inferSchema never emits
    // (enum+minimum, minLength, minItems, required-absent-from-properties), so
    // this actually exercises the validity reconciliation (R10 regression lock).
    const leaf = fc.oneof(
      fc.record({ type: fc.constant('integer'), minimum: fc.integer({ min: 1, max: 50 }) }),
      // enum + minimum, kept SATISFIABLE: every enum value is >= the minimum.
      fc.integer({ min: 0, max: 50 }).chain((m) =>
        fc.record({
          type: fc.constant('integer'),
          // unique enum values (JSON Schema forbids duplicates), all >= minimum.
          enum: fc.uniqueArray(fc.integer({ min: m, max: m + 50 }), { minLength: 1, maxLength: 4 }),
          minimum: fc.constant(m),
        }),
      ),
      fc.record({ type: fc.constant('string'), minLength: fc.integer({ min: 1, max: 12 }) }),
      fc.record({
        type: fc.constant('array'),
        items: fc.constant({ type: 'string' }),
        minItems: fc.integer({ min: 0, max: 4 }),
      }),
      fc.record({ type: fc.constant('boolean') }),
    )
    const constrainedSchema = fc
      .dictionary(safeKey, leaf, { minKeys: 1, maxKeys: 5 })
      .chain((properties) =>
        fc
          .subarray(Object.keys(properties))
          .map((required) => ({ type: 'object', properties, required })),
      )
    fc.assert(
      fc.property(constrainedSchema, (schema) => {
        expect(() => sampleFromSchema(schema)).not.toThrow()
        const sample = sampleFromSchema(schema)
        expect(validateConfig(schema, sample).valid).toBe(true)
      }),
      { numRuns: 60 },
    )
  })

  test('PROP-CL02: diffConfig(x, x) is always empty and never mutates', () => {
    fc.assert(
      fc.property(objectConfig, (config) => {
        const snapshot = JSON.parse(JSON.stringify(config))
        expect(diffConfig(config, config)).toEqual([])
        expect(config).toEqual(snapshot)
      }),
    )
  })

  test('PROP-D02: with defaults present, existing values survive and missing ones fill', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'integer', default: 99 },
        b: { type: 'string', default: 'D' },
      },
    }
    const parsed = parseSchema(schema)
    if (!parsed.ok) throw new Error('bad')
    fc.assert(
      fc.property(
        fc.record({ a: fc.option(fc.integer(), { nil: undefined }) }, { requiredKeys: [] }),
        (partial) => {
          const out = applyDefaults(parsed.root, partial) as Record<string, unknown>
          // b always fills (never provided); a keeps its value if provided.
          expect(out.b).toBe('D')
          if (partial.a !== undefined) expect(out.a).toBe(partial.a)
          else expect(out.a).toBe(99)
        },
      ),
    )
  })
})
