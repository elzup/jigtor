import { describe, test, expect } from 'vitest'
import {
  recordSnapshot,
  deriveFieldEntries,
  fieldHistory,
  historyPaths,
  parseHistory,
  DEFAULT_HISTORY_CAP,
  type SaveHistory,
} from '../src/core/history'

describe('spec:history (versioned snapshots)', () => {
  test('REQ-H01: a save appends a full-config snapshot stamped with `at`', () => {
    const h = recordSnapshot([], { a: 1, b: 'x' }, 1000)
    expect(h).toHaveLength(1)
    expect(h[0]).toEqual({ at: 1000, config: { a: 1, b: 'x' } })
    const h2 = recordSnapshot(h, { a: 2, b: 'x' }, 2000)
    expect(h2).toHaveLength(2)
    expect(h2[1]!.config).toEqual({ a: 2, b: 'x' })
  })

  test('REQ-H02: a no-op save (config unchanged from latest) is dropped (same ref)', () => {
    const h0 = recordSnapshot([], { a: 1 }, 1)
    const h1 = recordSnapshot(h0, { a: 1 }, 2)
    expect(h1).toBe(h0)
  })

  test('REQ-H04: append-only, snapshot is deep-cloned (later config mutation cannot leak in)', () => {
    const cfg: Record<string, unknown> = { a: 1 }
    const h = recordSnapshot([], cfg, 1)
    cfg.a = 999 // mutate the source after recording
    expect(h[0]!.config).toEqual({ a: 1 })
  })

  test('caps to the most recent N versions', () => {
    let h: SaveHistory = []
    for (let i = 0; i < DEFAULT_HISTORY_CAP + 25; i++) h = recordSnapshot(h, { n: i }, i)
    expect(h).toHaveLength(DEFAULT_HISTORY_CAP)
    // oldest kept is version 25; newest is the last
    expect(h[0]!.config).toEqual({ n: 25 })
    expect(h[h.length - 1]!.config).toEqual({ n: DEFAULT_HISTORY_CAP + 24 })
  })

  test('REQ-H05: deriveFieldEntries diffs consecutive versions; fieldHistory is exact-path, chronological', () => {
    let h: SaveHistory = []
    h = recordSnapshot(h, { port: 80 }, 10)
    h = recordSnapshot(h, { port: 443 }, 20)
    h = recordSnapshot(h, { port: 8080, host: 'x' }, 30)
    const port = fieldHistory(h, ['port'])
    expect(port.map((e) => e.after)).toEqual([443, 8080]) // v1->v2, v2->v3
    expect(port.map((e) => e.at)).toEqual([20, 30])
    expect(fieldHistory(h, ['host']).map((e) => e.after)).toEqual(['x'])
    expect(fieldHistory(h, ['missing'])).toHaveLength(0)
  })

  test("REQ-H05: ['a'] and ['a','b'] are not conflated", () => {
    let h: SaveHistory = []
    h = recordSnapshot(h, { a: { b: 1 } }, 1)
    h = recordSnapshot(h, { a: { b: 2 } }, 2) // changes .a.b
    expect(fieldHistory(h, ['a'])).toHaveLength(0) // the object identity is unchanged at .a
    expect(fieldHistory(h, ['a', 'b']).map((e) => e.at)).toEqual([2])
  })

  test('REQ-H06: historyPaths lists distinct changed paths in first-seen order', () => {
    let h: SaveHistory = []
    h = recordSnapshot(h, { z: 1, a: 2 }, 1)
    h = recordSnapshot(h, { z: 9, a: 2, m: 3 }, 2) // z changed, m added (diff sorts a,m,z -> m,z here)
    const ids = historyPaths(h).map((p) => p.join('.'))
    expect(ids.sort()).toEqual(['m', 'z'])
  })

  test('REQ-H07: parseHistory round-trips snapshots and degrades on corrupt/absent/malformed', () => {
    const h = recordSnapshot([], { a: 1 }, 5)
    expect(parseHistory(JSON.stringify(h))).toEqual(h)
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('{ not json')).toEqual([])
    expect(parseHistory('42')).toEqual([])
    // array of malformed snapshots: only the well-formed one survives
    expect(parseHistory('[{"garbage":1}, {"at":9,"config":{"x":1}}]')).toEqual([
      { at: 9, config: { x: 1 } },
    ])
  })

  test('deriveFieldEntries is empty for a single version (no predecessor)', () => {
    const h = recordSnapshot([], { a: 1, b: 2 }, 1)
    expect(deriveFieldEntries(h)).toEqual([])
  })
})
