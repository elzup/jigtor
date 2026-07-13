// spec:defaults — fill missing fields from schema default/example, immutably.
import type { FieldNode } from './types'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// The value to seed a leaf field with, if any (default wins over example).
function seedValue(field: FieldNode): { has: true; value: unknown } | { has: false } {
  if (field.kind === 'string' || field.kind === 'number' || field.kind === 'boolean') {
    if (field.default !== undefined) return { has: true, value: field.default }
    if (field.example !== undefined) return { has: true, value: field.example }
  }
  return { has: false }
}

// Returns the (possibly new) value for `field` given the current value, or a
// sentinel meaning "nothing to add here" so callers can avoid phantom objects.
const NOTHING = Symbol('nothing')

function fill(field: FieldNode, current: unknown): unknown | typeof NOTHING {
  if (field.kind === 'object') {
    // REQ-D03: a PRESENT but non-object value (scalar/array/null) is a type
    // mismatch, not a missing key — never overwrite it with a fabricated object.
    // The validator surfaces the mismatch; applyDefaults must preserve the data.
    if (current !== undefined && !isObj(current)) return current
    const base = isObj(current) ? current : undefined
    let next: Record<string, unknown> | undefined
    for (const child of field.children) {
      const key = child.path.at(-1)!
      const childCurrent = base ? base[key] : undefined
      const filled = fill(child, childCurrent)
      if (filled === NOTHING) continue
      if (!next) next = base ? { ...base } : {}
      next[key] = filled
    }
    // REQ-D04: only produce an object if the input had one or we added something.
    if (next) return next
    return base ?? NOTHING
  }

  // leaf (string/number/boolean) or array/unknown
  if (current !== undefined) return current // REQ-D03: never overwrite existing
  const seed = seedValue(field) // REQ-D07: array/unknown seedValue -> has:false
  return seed.has ? seed.value : NOTHING
}

export function applyDefaults(root: FieldNode, config: unknown): unknown {
  const filled = fill(root, config)
  return filled === NOTHING ? config : filled
}
