import { describe, test, expect } from 'vitest'
import { diffConfig } from '../src/core/diffConfig'

describe('spec:changelog', () => {
  test('REQ-CL01: equal values -> no changes', () => {
    expect(diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([])
  })

  test('REQ-CL02: changed leaf', () => {
    expect(diffConfig({ max: 20 }, { max: 30 })).toEqual([
      { path: ['max'], before: 20, after: 30, kind: 'changed' },
    ])
  })

  test('REQ-CL03: added key', () => {
    expect(diffConfig({}, { key: 'x' })).toEqual([
      { path: ['key'], before: undefined, after: 'x', kind: 'added' },
    ])
  })

  test('REQ-CL04: removed key', () => {
    expect(diffConfig({ key: 'x' }, {})).toEqual([
      { path: ['key'], before: 'x', after: undefined, kind: 'removed' },
    ])
  })

  test('REQ-CL05: nested object recursion with full path', () => {
    const changes = diffConfig({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })
    expect(changes).toEqual([{ path: ['a', 'b', 'c'], before: 1, after: 2, kind: 'changed' }])
  })

  test('REQ-CL06: arrays compared as a whole value', () => {
    const changes = diffConfig({ tags: [1, 2] }, { tags: [1, 2, 3] })
    expect(changes).toEqual([
      { path: ['tags'], before: [1, 2], after: [1, 2, 3], kind: 'changed' },
    ])
    // equal arrays -> no change
    expect(diffConfig({ tags: [1, 2] }, { tags: [1, 2] })).toEqual([])
  })

  test('REQ-CL07: does not mutate inputs; no throw on odd values', () => {
    const before = { a: 1 }
    const after = { a: 1, b: null }
    expect(() => diffConfig(before, after)).not.toThrow()
    diffConfig(before, after)
    expect(before).toEqual({ a: 1 })
    expect(after).toEqual({ a: 1, b: null })
    // primitives / null / arrays at the root must not throw
    expect(() => diffConfig(null, 5)).not.toThrow()
    expect(() => diffConfig([1], { a: 1 })).not.toThrow()
  })

  test('REQ-CL08: deterministic ordering by path', () => {
    const a = diffConfig({}, { z: 1, a: 2, m: 3 })
    const b = diffConfig({}, { m: 3, z: 1, a: 2 })
    expect(a).toEqual(b)
    expect(a.map((c) => c.path.join('/'))).toEqual(['a', 'm', 'z'])
  })

  test('REQ-CL09: only changed paths appear', () => {
    const changes = diffConfig({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, c: 3 })
    expect(changes).toEqual([{ path: ['b'], before: 2, after: 99, kind: 'changed' }])
  })

  test('type change object<->scalar -> single changed at that path', () => {
    expect(diffConfig({ a: { x: 1 } }, { a: 5 })).toEqual([
      { path: ['a'], before: { x: 1 }, after: 5, kind: 'changed' },
    ])
  })
})
