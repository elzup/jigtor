// Resolve the sub-schema that governs a value at a given JSON path, so the Tree
// editor can render schema-aware widgets (enum -> radio/select, bounded number
// -> slider) on top of its schema-independent base. Walks the V1 subset only:
// object `properties` and a single array `items` schema. Returns null when the
// path leaves the described shape (unknown key, $ref, tuple items, etc.), which
// callers treat as "no constraints — fall back to the type-based editor".
import type { JsonPath } from './jsonEdit'

export type SubSchema = {
  type?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function resolveSchemaAt(schema: unknown, path: JsonPath): SubSchema | null {
  let node: unknown = schema
  for (const key of path) {
    if (!isObject(node)) return null
    if (typeof key === 'number') {
      node = node.items // array element schema (single-schema items only)
    } else {
      const props = node.properties
      node = isObject(props) ? props[key] : undefined
    }
  }
  return isObject(node) ? (node as SubSchema) : null
}
