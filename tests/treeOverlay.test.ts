import { describe, test, expect } from 'vitest'
import { orderedChildSlots } from '../src/core/treeOverlay'

const keys = (cfg: string[], schema: string[] | null) =>
  orderedChildSlots(cfg, schema).map((s) => s.key)

describe('orderedChildSlots', () => {
  test('no schema: config order, all present', () => {
    expect(orderedChildSlots(['b', 'a'], null)).toEqual([
      { key: 'b', presence: 'present' },
      { key: 'a', presence: 'present' },
    ])
  })

  test('present keys keep CONFIG order, not schema order (file order is truth)', () => {
    // The user arranges key order via ↑↓ move, so config order wins.
    expect(orderedChildSlots(['b', 'a'], ['a', 'b'])).toEqual([
      { key: 'b', presence: 'present' },
      { key: 'a', presence: 'present' },
    ])
  })

  test('schema keys absent from config are appended as missing, in schema order (REQ-TO02)', () => {
    expect(orderedChildSlots(['a'], ['a', 'b', 'c'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'b', presence: 'missing' },
      { key: 'c', presence: 'missing' },
    ])
  })

  test('config keys not in schema still render (present), before the missing ones', () => {
    expect(orderedChildSlots(['a', 'z', 'y'], ['a', 'b'])).toEqual([
      { key: 'a', presence: 'present' },
      { key: 'z', presence: 'present' },
      { key: 'y', presence: 'present' },
      { key: 'b', presence: 'missing' },
    ])
  })

  test('empty config against a schema surfaces every property as missing', () => {
    expect(orderedChildSlots([], ['a', 'b'])).toEqual([
      { key: 'a', presence: 'missing' },
      { key: 'b', presence: 'missing' },
    ])
  })

  test('a moved key is reflected because config order is preserved (REQ-TO01)', () => {
    const schema = ['host', 'port', 'tls']
    // user moved tls to the front — display follows config order
    expect(keys(['tls', 'host', 'port'], schema)).toEqual(['tls', 'host', 'port'])
  })
})
