// spec:parser — JSON Schema subset -> FieldNode tree.
import type {
  ArrayField,
  BooleanField,
  FieldNode,
  FieldPath,
  NumberField,
  ObjectField,
  ParseResult,
  StringField,
  UnknownField,
} from './types'

type Schema = Record<string, unknown>

const isPlainObject = (v: unknown): v is Schema =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined

// example, or the first entry of examples[] (draft-06+). Returned raw; callers
// keep it only when it matches the field's type.
const rawExample = (schema: Schema): unknown => {
  if ('example' in schema) return schema['example']
  const examples = schema['examples']
  if (Array.isArray(examples) && examples.length > 0) return examples[0]
  return undefined
}

function labelFor(schema: Schema, path: FieldPath): string {
  const title = asString(schema['title'])
  if (title) return title
  const last = path.at(-1)
  return last ?? 'root'
}

function convert(
  schema: unknown,
  path: FieldPath,
  required: boolean,
): { ok: true; node: FieldNode } | { ok: false; error: string } {
  if (!isPlainObject(schema)) {
    return { ok: false, error: `schema at /${path.join('/')} must be an object` }
  }

  const type = schema['type']
  const label = labelFor(schema, path)
  const description = asString(schema['description'])
  const base = { path, label, required, ...(description ? { description } : {}) }

  switch (type) {
    case 'string': {
      const field: StringField = { ...base, kind: 'string' }
      const def = asString(schema['default'])
      if (def !== undefined) field.default = def
      const ex = asString(rawExample(schema))
      if (ex !== undefined) field.example = ex
      const enumVals = asStringArray(schema['enum'])
      if (enumVals) field.enum = enumVals
      const minLength = asNumber(schema['minLength'])
      if (minLength !== undefined) field.minLength = minLength
      const maxLength = asNumber(schema['maxLength'])
      if (maxLength !== undefined) field.maxLength = maxLength
      const pattern = asString(schema['pattern'])
      if (pattern !== undefined) field.pattern = pattern
      return { ok: true, node: field }
    }
    case 'number':
    case 'integer': {
      const field: NumberField = { ...base, kind: 'number', integer: type === 'integer' }
      const def = asNumber(schema['default'])
      if (def !== undefined) field.default = def
      const ex = asNumber(rawExample(schema))
      if (ex !== undefined) field.example = ex
      const enumVals = Array.isArray(schema['enum'])
        ? (schema['enum'] as unknown[]).filter((x): x is number => typeof x === 'number')
        : undefined
      if (enumVals && enumVals.length > 0) field.enum = enumVals
      const minimum = asNumber(schema['minimum'])
      if (minimum !== undefined) field.minimum = minimum
      const maximum = asNumber(schema['maximum'])
      if (maximum !== undefined) field.maximum = maximum
      return { ok: true, node: field }
    }
    case 'boolean': {
      const field: BooleanField = { ...base, kind: 'boolean' }
      if (typeof schema['default'] === 'boolean') field.default = schema['default']
      const ex = rawExample(schema)
      if (typeof ex === 'boolean') field.example = ex
      return { ok: true, node: field }
    }
    case 'object': {
      const props = isPlainObject(schema['properties']) ? schema['properties'] : {}
      const requiredKeys = new Set(asStringArray(schema['required']) ?? [])
      const children: FieldNode[] = []
      for (const key of Object.keys(props)) {
        const childPath = [...path, key]
        const child = convert(props[key], childPath, requiredKeys.has(key))
        if (child.ok) {
          children.push(child.node)
          continue
        }
        // REQ-P10: best-effort — a child with unsupported/missing type (e.g.
        // { $ref: '#' }) becomes a read-only 'unknown' placeholder instead of
        // aborting the whole parse. It keeps its path so a validator error on a
        // required-but-unsupported child still has somewhere to render.
        const childSchema = isPlainObject(props[key]) ? props[key] : {}
        const unknown: UnknownField = {
          path: childPath,
          label: labelFor(childSchema, childPath),
          required: requiredKeys.has(key),
          kind: 'unknown',
          reason: child.error,
        }
        const desc = asString(childSchema['description'])
        if (desc) unknown.description = desc
        children.push(unknown)
      }
      const field: ObjectField = { ...base, kind: 'object', children }
      return { ok: true, node: field }
    }
    case 'array': {
      if (!isPlainObject(schema['items'])) {
        return { ok: false, error: `array at /${path.join('/')} requires object "items"` }
      }
      const item = convert(schema['items'], [...path, '[]'], false)
      if (!item.ok) return item
      const field: ArrayField = { ...base, kind: 'array', item: item.node }
      return { ok: true, node: field }
    }
    default:
      return {
        ok: false,
        error: `unsupported or missing "type" at /${path.join('/')}: ${JSON.stringify(type)}`,
      }
  }
}

export function parseSchema(schema: unknown): ParseResult {
  const r = convert(schema, [], false)
  return r.ok ? { ok: true, root: r.node } : { ok: false, error: r.error }
}
