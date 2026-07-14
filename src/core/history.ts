// spec:history — versioned, full-config save history.
// A "save" appends a snapshot of the WHOLE config (not just a diff), so any past
// version can be restored. The log is capped to the most recent N versions and
// stored gzip-compressed (`.jigtor/history.json.gz`); gzip lives in the DOM shell
// (browser CompressionStream), this module stays pure. The per-field "how did
// .server.port change over time" view is DERIVED by diffing consecutive versions.
import type { FieldPath } from './types'
import { diffConfig, type Change } from './diffConfig'

export type Snapshot = { at: number; config: unknown }
export type SaveHistory = Snapshot[]

// Keep only the most recent N versions so the (gzipped) log never grows unbounded.
export const DEFAULT_HISTORY_CAP = 200

const clone = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null))
const pathId = (path: FieldPath): string => JSON.stringify(path)

// Append a full-config snapshot, keeping at most `cap` most-recent versions. A
// no-op save (config identical to the latest snapshot) is dropped so versions
// stay meaningful. `at` is injected (not read from a clock) so this stays pure.
// Never mutates the input array.
export function recordSnapshot(
  history: SaveHistory,
  config: unknown,
  at: number,
  cap: number = DEFAULT_HISTORY_CAP,
): SaveHistory {
  const last = history[history.length - 1]
  if (last && JSON.stringify(last.config) === JSON.stringify(config)) return history
  const next = [...history, { at, config: clone(config) }]
  return next.length > cap ? next.slice(next.length - cap) : next
}

export type FieldHistoryEntry = {
  path: FieldPath
  before: unknown
  after: unknown
  kind: Change['kind'] // 'added' | 'removed' | 'changed'
  at: number // epoch ms of the version that introduced the change
}

// Per-field change entries derived by diffing each version against the previous
// one (oldest→newest). The first version has no predecessor, so its values are
// not "changes"; they appear once a later version alters them.
export function deriveFieldEntries(history: SaveHistory): FieldHistoryEntry[] {
  const out: FieldHistoryEntry[] = []
  for (let i = 1; i < history.length; i++) {
    for (const c of diffConfig(history[i - 1]!.config, history[i]!.config)) {
      out.push({ path: c.path, before: c.before, after: c.after, kind: c.kind, at: history[i]!.at })
    }
  }
  return out
}

// Every derived change for one field, oldest-first.
export function fieldHistory(history: SaveHistory, path: FieldPath): FieldHistoryEntry[] {
  const id = pathId(path)
  return deriveFieldEntries(history).filter((e) => pathId(e.path) === id)
}

// Distinct field paths that changed at least once across versions, first-seen order.
export function historyPaths(history: SaveHistory): FieldPath[] {
  const seen = new Set<string>()
  const out: FieldPath[] = []
  for (const e of deriveFieldEntries(history)) {
    const id = pathId(e.path)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(e.path)
  }
  return out
}

// A stored element is only a usable snapshot if it has a numeric `at` and a
// `config` key; tampered/legacy shapes are dropped.
const isSnapshot = (e: unknown): e is Snapshot =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as { at?: unknown }).at === 'number' &&
  'config' in (e as object)

// REQ-H07: parse persisted history (decompressed JSON text) defensively. Null
// (absent), invalid JSON, a non-array, or malformed snapshots all degrade to an
// empty/filtered history — never throws.
export function parseHistory(raw: string | null): SaveHistory {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSnapshot) : []
  } catch {
    return []
  }
}
