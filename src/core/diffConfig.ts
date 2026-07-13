// spec:changelog — path-level diff between the loaded config and the edited one.
import type { FieldPath } from './types'

export type ChangeKind = 'added' | 'removed' | 'changed'
export type Change = {
  path: FieldPath
  before: unknown
  after: unknown
  kind: ChangeKind
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Structural equality for JSON values. Arrays are compared as whole values
// (REQ-CL06); objects key-by-key; primitives with Object.is-ish semantics.
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => jsonEqual(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!jsonEqual(a[k], b[k])) return false
    return true
  }
  return false
}

function walk(before: unknown, after: unknown, path: FieldPath, out: Change[]): void {
  if (jsonEqual(before, after)) return // REQ-CL09: unchanged paths omitted

  // REQ-CL05: recurse only when BOTH sides are plain objects; arrays (REQ-CL06)
  // and object<->scalar type changes are reported as a single change here.
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort() // REQ-CL08
    for (const key of keys) {
      walk(before[key], after[key], [...path, key], out)
    }
    return
  }

  const kind: ChangeKind =
    before === undefined ? 'added' : after === undefined ? 'removed' : 'changed'
  out.push({ path, before, after, kind })
}

export function diffConfig(before: unknown, after: unknown): Change[] {
  const out: Change[] = []
  walk(before, after, [], out)
  return out
}
