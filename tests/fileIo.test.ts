import { describe, test, expect } from 'vitest'
import { parseJsonFile, serializeConfig, classifyFile } from '../src/core/fileIo'

describe('spec:file-io', () => {
  test('REQ-F01: valid JSON -> ok with value', () => {
    const r = parseJsonFile('{"max":20,"key":"abc"}')
    expect(r).toEqual({ ok: true, value: { max: 20, key: 'abc' } })
  })

  test('REQ-F02: invalid JSON -> ok:false, no throw', () => {
    let r: ReturnType<typeof parseJsonFile>
    expect(() => {
      r = parseJsonFile('{ not json ')
    }).not.toThrow()
    r = parseJsonFile('{ not json ')
    expect(r.ok).toBe(false)
  })

  test('REQ-F03: serialize uses 2-space indent + trailing newline', () => {
    const out = serializeConfig({ a: 1 })
    expect(out).toBe('{\n  "a": 1\n}\n')
  })

  test('REQ-F04: round-trip preserves keys/values', () => {
    const text = '{"max":20,"key":"abc","nested":{"flag":true},"list":[1,2]}'
    const parsed = parseJsonFile(text)
    if (!parsed.ok) throw new Error('expected ok')
    const round = parseJsonFile(serializeConfig(parsed.value))
    expect(round).toEqual(parsed)
  })

  test('REQ-F05: schema detection by name and by content', () => {
    expect(classifyFile('config.schema.json', { properties: {} })).toBe('schema')
    expect(classifyFile('anything.json', { $schema: 'http://json-schema.org/draft-07/schema#' })).toBe('schema')
    expect(classifyFile('x.json', { type: 'object', properties: {} })).toBe('schema')
  })

  test('REQ-F06: config detection and unknown fallback', () => {
    expect(classifyFile('config.json', { max: 20, key: 'abc' })).toBe('config')
    expect(classifyFile('random.json', 42)).toBe('unknown')
  })
})
