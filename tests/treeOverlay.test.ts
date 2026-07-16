import { describe, test, expect } from 'vitest'
import { orderedChildSlots } from '../src/core/treeOverlay'

const keys = (cfg: string[], schema: string[] | null) =>
  orderedChildSlots(cfg, schema).map((s) => s.key)

describe('orderedChildSlots', () => {
  test('no schema: config order, all present (unchanged behaviour)', () => {
    expect(orderedChildSlots(['b', 'a'], null)).toEqual([
      { key: 'b', presence: 'present' },
      { key: 'a', presence: 'present' },
    ])
  })

  test('present keys follow schema order, not config order (REQ-TO01)', () => {
    expect(orderedChildSlots(['b', 'a'], ['a', 'b'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'b', presence: 'present' },
    ])
  })

  test('schema keys absent from config are marked missing, in schema order (REQ-TO02)', () => {
    expect(orderedChildSlots(['a'], ['a', 'b', 'c'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'b', presence: 'missing' },
      { key: 'c', presence: 'missing' },
    ])
  })

  test('config-only keys come after schema keys, in config order', () => {
    expect(orderedChildSlots(['a', 'z', 'y'], ['a'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'z', presence: 'extra' },
      { key: 'y', presence: 'extra' },
    ])
  })

  test('display order is stable regardless of config key order (add/delete safety, REQ-TO01)', () => {
    const schema = ['host', 'port', 'tls']
    expect(keys(['tls', 'host'], schema)).toEqual(['host', 'port', 'tls'])
    expect(keys(['host', 'tls'], schema)).toEqual(['host', 'port', 'tls'])
    expect(keys(['port', 'tls', 'host'], schema)).toEqual(['host', 'port', 'tls'])
  })

  test('mixed present / missing / extra in one object', () => {
    expect(orderedChildSlots(['x', 'a'], ['a', 'b'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'b', presence: 'missing' },
      { key: 'x', presence: 'extra' },
    ])
  })

  test('empty config against a schema surfaces every property as missing', () => {
    expect(orderedChildSlots([], ['a', 'b'])).toEqual([
      { key: 'a', presence: 'missing' },
      { key: 'b', presence: 'missing' },
    ])
  })
})
