// spec:schema-infer — infer a draft JSON Schema (V1 subset) from a config value.
// Output is a plain JSON Schema object the user can adjust and feed to parseSchema.

type JsonSchema = Record<string, unknown>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function inferValue(value: unknown): JsonSchema {
  if (value === null) return {} // REQ-I05: unknown type -> no constraint
  if (typeof value === 'string') return { type: 'string', examples: [value] }
  if (typeof value === 'boolean') return { type: 'boolean', examples: [value] }
  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'integer' : 'number', examples: [value] }
  }
  if (Array.isArray(value)) {
    // REQ-I04: empty array -> no items.
    // REQ-I02: constrain `items` ONLY for a homogeneous simple-primitive array,
    // where every element provably validates. For mixed / object / nested-array
    // element sets, leave items unconstrained so the source config always
    // validates against its own inferred schema (the round-trip guarantee).
    const items = inferArrayItems(value)
    return items ? { type: 'array', items } : { type: 'array' }
  }
  if (isPlainObject(value)) {
    const properties: Record<string, JsonSchema> = {}
    for (const [key, v] of Object.entries(value)) properties[key] = inferValue(v)
    // REQ-I01: required is empty — a single sample cannot prove requiredness.
    return { type: 'object', properties, required: [] }
  }
  return {} // undefined / functions etc. — treat as unconstrained
}

// Returns an item schema that EVERY element validates against, or undefined
// (unconstrained) when that cannot be guaranteed within the V1 subset.
function inferArrayItems(arr: unknown[]): JsonSchema | undefined {
  if (arr.length === 0) return undefined
  if (arr.every((v) => typeof v === 'string')) return { type: 'string' }
  if (arr.every((v) => typeof v === 'boolean')) return { type: 'boolean' }
  if (arr.every((v) => typeof v === 'number')) {
    return { type: arr.every((v) => Number.isInteger(v as number)) ? 'integer' : 'number' }
  }
  return undefined
}

export function inferSchema(config: unknown): JsonSchema {
  return inferValue(config)
}

