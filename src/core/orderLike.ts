// Reorder an object's keys to match a template (the original file), recursively,
// so saving keeps the original key order regardless of how edits were applied.
// Keys present in `value` but not in `template` (e.g. newly added) are appended
// in their current order. Arrays are positional and never reordered — only their
// elements are aligned to the matching template element. Non-objects pass through.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function orderLike(value: unknown, template: unknown): unknown {
  if (Array.isArray(value)) {
    const tmpl = Array.isArray(template) ? template : []
    return value.map((v, i) => orderLike(v, tmpl[i]))
  }
  if (isObject(value)) {
    const tmpl = isObject(template) ? template : {}
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(tmpl)) {
      if (key in value) out[key] = orderLike(value[key], tmpl[key])
    }
    for (const key of Object.keys(value)) {
      if (!(key in out)) out[key] = orderLike(value[key], undefined)
    }
    return out
  }
  return value
}
