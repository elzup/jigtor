import { describe, test, expect } from 'vitest'
import {
  recordSave,
  fieldHistory,
  historyPaths,
  parseHistory,
  type SaveHistory,
} from '../src/core/history'

describe('spec:history', () => {
  test('REQ-H01/H03: a save appends one stamped entry per changed field', () => {
    const h = recordSave([], { a: 1, b: 'x' }, { a: 2, b: 'x', c: true }, 1000)
    expect(h).toHaveLength(2) // a changed, c added; b unchanged
    const a = h.find((e) => e.path.join('.') === 'a')!
    expect(a).toMatchObject({ before: 1, after: 2, kind: 'changed', at: 1000 })
    const c = h.find((e) => e.path.join('.') === 'c')!
    expect(c).toMatchObject({ before: undefined, after: true, kind: 'added', at: 1000 })
  })

  test('REQ-H02: a no-op save (no diff) leaves history untouched (same ref)', () => {
    const h0: SaveHistory = recordSave([], {}, { a: 1 }, 1)
    const h1 = recordSave(h0, { a: 1 }, { a: 1 }, 2)
    expect(h1).toBe(h0)
  })

  test('REQ-H04: append-only, input array is never mutated', () => {
    const h0 = recordSave([], {}, { a: 1 }, 1)
    const before = [...h0]
    const h1 = recordSave(h0, { a: 1 }, { a: 2 }, 2)
    expect(h0).toEqual(before) // untouched
    expect(h1).not.toBe(h0)
    expect(h1).toHaveLength(2)
  })

  test('REQ-H05: fieldHistory returns only exact-path entries, chronological', () => {
    let h: SaveHistory = []
    h = recordSave(h, {}, { port: 80 }, 10)
    h = recordSave(h, { port: 80 }, { port: 443 }, 20)
    h = recordSave(h, { port: 443 }, { port: 8080, host: 'x' }, 30)
    const port = fieldHistory(h, ['port'])
    expect(port.map((e) => e.after)).toEqual([80, 443, 8080])
    expect(port.map((e) => e.at)).toEqual([10, 20, 30])
    expect(fieldHistory(h, ['host'])).toHaveLength(1)
    expect(fieldHistory(h, ['missing'])).toHaveLength(0)
  })

  test("REQ-H05: ['a'] and ['a','b'] are not conflated", () => {
    let h: SaveHistory = []
    h = recordSave(h, {}, { a: { b: 1 } }, 1) // adds .a (whole object)
    h = recordSave(h, { a: { b: 1 } }, { a: { b: 2 } }, 2) // changes .a.b
    expect(fieldHistory(h, ['a']).map((e) => e.at)).toEqual([1])
    expect(fieldHistory(h, ['a', 'b']).map((e) => e.at)).toEqual([2])
  })

  test('REQ-H06: historyPaths lists distinct paths in first-seen order', () => {
    let h: SaveHistory = []
    h = recordSave(h, {}, { z: 1, a: 2 }, 1) // diffConfig sorts -> a, z
    h = recordSave(h, { z: 1, a: 2 }, { z: 9, a: 2, m: 3 }, 2) // z changed, m added
    const ids = historyPaths(h).map((p) => p.join('.'))
    expect(ids).toEqual(['a', 'z', 'm'])
  })

  test('REQ-H07: parseHistory round-trips valid data and never throws on corrupt/absent', () => {
    const h = recordSave([], {}, { a: 1 }, 5)
    // round-trip through JSON like localStorage would
    expect(parseHistory(JSON.stringify(h))).toEqual(h)
    // absent, corrupt JSON, and non-array all degrade to [] without throwing
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('{ not json')).toEqual([])
    expect(parseHistory('42')).toEqual([])
    expect(parseHistory('{"a":1}')).toEqual([])
  })
})
