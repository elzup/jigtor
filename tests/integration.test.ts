// End-to-end: the shipped example files flow through the whole core pipeline
// exactly as the app (main.ts) drives it: classify -> parse schema -> validate ->
// render -> edit -> re-validate -> serialize.
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseJsonFile, classifyFile, serializeConfig } from '../src/core/fileIo'
import { parseSchema } from '../src/core/parseSchema'
import { validateConfig } from '../src/core/validateConfig'
import { renderForm } from '../src/core/renderForm'
import { inferSchema } from '../src/core/inferSchema'
import { applyDefaults } from '../src/core/applyDefaults'
import { diffConfig } from '../src/core/diffConfig'
import type { FieldPath } from '../src/core/types'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples')
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')

function setAt(root: unknown, path: FieldPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  const base =
    typeof root === 'object' && root !== null && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {}
  return { ...base, [head!]: setAt(base[head!], rest, value) }
}

describe('integration: example config + schema', () => {
  const schemaParsed = parseJsonFile(read('config.schema.json'))
  const configParsed = parseJsonFile(read('config.json'))
  if (!schemaParsed.ok || !configParsed.ok) throw new Error('example files must be valid JSON')
  const schema = schemaParsed.value
  const config = configParsed.value

  test('files classify correctly', () => {
    expect(classifyFile('config.schema.json', schema)).toBe('schema')
    expect(classifyFile('config.json', config)).toBe('config')
  })

  test('schema parses and the example config validates clean', () => {
    const r = parseSchema(schema)
    expect(r.ok).toBe(true)
    expect(validateConfig(schema, config)).toEqual({ valid: true, errors: [] })
  })

  test('no-schema flow: infer -> parse -> render -> validate (as main.ts drives it)', () => {
    // A config from an app that ships no schema.
    const legacy = { host: 'localhost', port: 8080, tls: false, tags: ['a', 'b'] }
    const inferred = inferSchema(legacy)
    const parsed = parseSchema(inferred)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    // seeding defaults is a no-op here (inferred schema has no default) and must
    // not alter the config.
    const seeded = applyDefaults(parsed.root, legacy)
    expect(seeded).toEqual(legacy)
    // the source config validates against its own inferred schema.
    expect(validateConfig(inferred, seeded).valid).toBe(true)
    // and it renders without throwing.
    const form = renderForm(parsed.root, seeded, [], () => {})
    expect(form.querySelector('[data-path="host"]')).toBeTruthy()
  })

  test('default seeding fills a missing field from schema default on load', () => {
    const schema = {
      type: 'object',
      properties: {
        max: { type: 'integer', default: 20 },
        key: { type: 'string' },
      },
    }
    const parsed = parseSchema(schema)
    if (!parsed.ok) throw new Error('bad')
    const seeded = applyDefaults(parsed.root, { key: 'abc' })
    expect(seeded).toEqual({ key: 'abc', max: 20 })
    expect(validateConfig(schema, seeded).valid).toBe(true)
  })

  test('diff baseline (FIND-R7-001): default-seed is NOT shown as a change; only user edits are', () => {
    // Mirrors main.ts buildForm(): seed defaults, then baseline = post-seed state.
    const schema = {
      type: 'object',
      properties: {
        host: { type: 'string', default: 'localhost' },
        port: { type: 'integer', default: 8080 },
        name: { type: 'string' },
      },
    }
    const parsed = parseSchema(schema)
    if (!parsed.ok) throw new Error('bad')
    // Flow A: load schema with only `{name}` in config, seed defaults.
    let config: unknown = applyDefaults(parsed.root, { name: 'app' })
    const baseline = JSON.parse(JSON.stringify(config)) // main.ts: state.original = clone post-seed
    // seeded defaults must NOT appear as changes
    expect(diffConfig(baseline, config)).toEqual([])
    // a real user edit shows up as exactly one change
    config = { ...(config as object), name: 'renamed' }
    expect(diffConfig(baseline, config)).toEqual([
      { path: ['name'], before: 'app', after: 'renamed', kind: 'changed' },
    ])
  })

  test('FIND-A1: seeding defaults into baseline too keeps a schema-added defaulted field non-dirty (reset works)', () => {
    // Simulates an in-session schema apply that ADDS a defaulted field: buildForm
    // seeds the default into BOTH config and the (already-established) baseline.
    const withNew = {
      type: 'object',
      properties: { name: { type: 'string' }, retries: { type: 'integer', default: 3 } },
    }
    const parsed = parseSchema(withNew)
    if (!parsed.ok) throw new Error('bad')
    let config: unknown = applyDefaults(parsed.root, { name: 'app' }) // { name, retries:3 }
    let baseline: unknown = applyDefaults(parsed.root, { name: 'app' }) // main.ts else-branch
    // the machine-seeded default is NOT a change, so no dead reset button
    expect(diffConfig(baseline, config)).toEqual([])
    // user edits it -> dirty; resetting to the baseline value clears it (not undefined)
    config = { ...(config as object), retries: 9 }
    expect(diffConfig(baseline, config)).toHaveLength(1)
    const base = (baseline as Record<string, unknown>)['retries']
    expect(base).toBe(3) // reset target is defined, so resetField uses setAt, not deleteAt+reseed
    config = { ...(config as object), retries: base }
    expect(diffConfig(baseline, config)).toEqual([])
  })

  test('a constraint violation is caught and surfaced on the right field', () => {
    const broken = setAt(config, ['max'], 999) // exceeds maximum:100
    const result = validateConfig(schema, broken)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.join('/') === 'max')).toBe(true)
  })

  test('renders a form and an edit round-trips through serialize', () => {
    const parsed = parseSchema(schema)
    if (!parsed.ok) throw new Error(parsed.error)
    const result = validateConfig(schema, config)
    let edited: unknown = config
    const form = renderForm(parsed.root, config, result.errors, (path, v) => {
      edited = setAt(edited, path, v)
    })
    // form has controls for the top-level fields
    expect(form.querySelector('[data-path="key"]')).toBeTruthy()
    expect(form.querySelector('[data-path="mode"]')).toBeTruthy()

    // simulate editing `key`
    const keyInput = form.querySelector('input[data-path="key"]') as HTMLInputElement
    keyInput.value = 'newKey42'
    keyInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect((edited as Record<string, unknown>)['key']).toBe('newKey42')

    // serialized output is valid JSON and still validates
    const out = serializeConfig(edited)
    expect(out.endsWith('\n')).toBe(true)
    const reparsed = parseJsonFile(out)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(validateConfig(schema, reparsed.value).valid).toBe(true)
  })
})
