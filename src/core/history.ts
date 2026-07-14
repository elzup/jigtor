// spec:history — per-field, per-save change history.
// A "save" is an export/commit of the config. On each save we diff the previously
// saved config against the newly saved one and append ONE entry per changed field,
// stamped with the save time. The log is append-only and groupable by field path,
// so the UI can show "how did .server.port change over time".
import type { FieldPath } from './types'
import { diffConfig, type Change } from './diffConfig'

export type FieldHistoryEntry = {
  path: FieldPath
  before: unknown
  after: unknown
  kind: Change['kind'] // 'added' | 'removed' | 'changed'
  at: number // epoch ms of the save
}

export type SaveHistory = FieldHistoryEntry[]

const pathId = (path: FieldPath): string => JSON.stringify(path)

// Append the field-level changes of one save. `at` is injected (not read from a
// clock) so the function is pure and deterministic for tests. A no-op save (no
// diff) leaves the history untouched. Never mutates the input array.
export function recordSave(
  history: SaveHistory,
  before: unknown,
  after: unknown,
  at: number,
): SaveHistory {
  const changes = diffConfig(before, after)
  if (changes.length === 0) return history
  const entries: FieldHistoryEntry[] = changes.map((c) => ({
    path: c.path,
    before: c.before,
    after: c.after,
    kind: c.kind,
    at,
  }))
  return [...history, ...entries]
}

// Every entry for one field, oldest-first (chronological insertion order).
export function fieldHistory(history: SaveHistory, path: FieldPath): FieldHistoryEntry[] {
  const id = pathId(path)
  return history.filter((e) => pathId(e.path) === id)
}

// REQ-H07: parse persisted history text defensively. Null (absent), invalid
// JSON, or a non-array all yield an empty history — never throws.
export function parseHistory(raw: string | null): SaveHistory {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SaveHistory) : []
  } catch {
    return []
  }
}

// Distinct field paths that have any history, in first-seen order.
export function historyPaths(history: SaveHistory): FieldPath[] {
  const seen = new Set<string>()
  const out: FieldPath[] = []
  for (const e of history) {
    const id = pathId(e.path)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(e.path)
  }
  return out
}
