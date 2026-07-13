// spec:schema-edit — edit a JSON Schema as flat field rows, immutably, plus a
// live sample-config generator for preview.

export type SchemaRow = {
  path: string[]
  type: string
  required: boolean
  default?: unknown
  description?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

type Schema = Record<string, unknown>
const isObj = (v: unknown): v is Schema =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const STRING_KEYS = ['minLength', 'maxLength', 'pattern'] as const
const NUMBER_KEYS = ['minimum', 'maximum'] as const

// ---- flatten (REQ-SE01/02/03) ----
function toRow(node: unknown, path: string[], required: boolean): SchemaRow {
  const n = isObj(node) ? node : {}
  const type = typeof n['type'] === 'string' ? (n['type'] as string) : ''
  const row: SchemaRow = { path, type, required }
  if ('default' in n) row.default = n['default']
  if (typeof n['description'] === 'string') row.description = n['description'] as string
  if (Array.isArray(n['enum'])) row.enum = n['enum'] as unknown[]
  if (type === 'number' || type === 'integer') {
    if (typeof n['minimum'] === 'number') row.minimum = n['minimum'] as number
    if (typeof n['maximum'] === 'number') row.maximum = n['maximum'] as number
  }
  if (type === 'string') {
    if (typeof n['minLength'] === 'number') row.minLength = n['minLength'] as number
    if (typeof n['maxLength'] === 'number') row.maxLength = n['maxLength'] as number
    if (typeof n['pattern'] === 'string') row.pattern = n['pattern'] as string
  }
  return row
}

function walkProps(objSchema: Schema, basePath: string[], rows: SchemaRow[]): void {
  const props = isObj(objSchema['properties']) ? objSchema['properties'] : {}
  const req = new Set(Array.isArray(objSchema['required']) ? (objSchema['required'] as string[]) : [])
  for (const key of Object.keys(props)) {
    const node = (props as Schema)[key]
    const path = [...basePath, key]
    rows.push(toRow(node, path, req.has(key)))
    if (isObj(node) && node['type'] === 'object') walkProps(node, path, rows)
  }
}

export function flattenSchema(schema: unknown): SchemaRow[] {
  const rows: SchemaRow[] = []
  if (isObj(schema)) walkProps(schema, [], rows)
  return rows
}

// ---- immutable navigation helpers ----
function updateNode(schema: Schema, path: string[], fn: (node: Schema) => Schema): Schema {
  const [head, ...rest] = path
  const props = isObj(schema['properties']) ? (schema['properties'] as Schema) : {}
  if (head === undefined || !(head in props)) return schema // path not found -> no-op
  const child = isObj(props[head]) ? (props[head] as Schema) : {}
  const newChild = rest.length === 0 ? fn(child) : updateNode(child, rest, fn)
  return { ...schema, properties: { ...props, [head]: newChild } }
}

// Apply fn to the container object at `path` (root when path is empty).
function updateContainer(schema: Schema, path: string[], fn: (node: Schema) => Schema): Schema {
  if (path.length === 0) return fn(schema)
  return updateNode(schema, path, fn)
}

// ---- editSchemaField (REQ-SE04/05) ----
function stripIncompatible(node: Schema, type: string): Schema {
  const out = { ...node }
  if (type !== 'string') for (const k of STRING_KEYS) delete out[k]
  if (type !== 'number' && type !== 'integer') for (const k of NUMBER_KEYS) delete out[k]
  // container keywords must go too, or they leave orphaned child rows that
  // reappear if the type is switched back (REQ-SE05).
  if (type !== 'object') {
    delete out['properties']
    delete out['required']
  }
  if (type !== 'array') delete out['items']
  return out
}

export function editSchemaField(
  schema: unknown,
  path: string[],
  patch: Partial<SchemaRow> & Record<string, unknown>,
): unknown {
  if (!isObj(schema) || path.length === 0) return schema
  const { required, path: _p, ...rest } = patch
  let next: Schema = schema

  if (Object.keys(rest).length > 0) {
    next = updateNode(next, path, (node) => {
      let out: Schema = { ...node }
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) delete out[k]
        else out[k] = v
      }
      if (typeof rest['type'] === 'string') out = stripIncompatible(out, rest['type'])
      return out
    })
  }

  if (required !== undefined) {
    const key = path[path.length - 1]!
    next = updateContainer(next, path.slice(0, -1), (parent) => {
      const cur = Array.isArray(parent['required']) ? (parent['required'] as string[]) : []
      const has = cur.includes(key)
      const req = required && !has ? [...cur, key] : !required && has ? cur.filter((k) => k !== key) : cur
      return { ...parent, required: req }
    })
  }
  return next
}

// ---- addSchemaField / removeSchemaField (REQ-SE06/07) ----
export function addSchemaField(
  schema: unknown,
  parentPath: string[],
  key: string,
  type: string,
): unknown {
  if (!isObj(schema)) return schema
  return updateContainer(schema, parentPath, (parent) => {
    if (parent['type'] !== 'object') return parent // non-object parent -> no-op
    const props = isObj(parent['properties']) ? (parent['properties'] as Schema) : {}
    if (key in props) return parent // duplicate -> no-op
    return { ...parent, properties: { ...props, [key]: { type } } }
  })
}

export function removeSchemaField(schema: unknown, path: string[]): unknown {
  if (!isObj(schema) || path.length === 0) return schema
  const key = path[path.length - 1]!
  return updateContainer(schema, path.slice(0, -1), (parent) => {
    const props = isObj(parent['properties']) ? (parent['properties'] as Schema) : {}
    if (!(key in props)) return parent
    const { [key]: _removed, ...restProps } = props
    const out: Schema = { ...parent, properties: restProps }
    if (Array.isArray(parent['required'])) {
      out['required'] = (parent['required'] as string[]).filter((k) => k !== key)
    }
    return out
  })
}

// ---- sampleFromSchema (REQ-SE09) ----
function exampleOf(n: Schema): unknown {
  if ('example' in n) return n['example']
  const ex = n['examples']
  if (Array.isArray(ex) && ex.length > 0) return ex[0]
  return undefined
}

function stringPlaceholder(n: Schema): string {
  let s = 'sample'
  const min = typeof n['minLength'] === 'number' ? (n['minLength'] as number) : 0
  while (s.length < min) s += 'x'
  const max = typeof n['maxLength'] === 'number' ? (n['maxLength'] as number) : undefined
  if (max !== undefined && s.length > max) s = s.slice(0, max)
  return s
}

function numberPlaceholder(n: Schema): number {
  let v = typeof n['minimum'] === 'number' ? (n['minimum'] as number) : 0
  const max = typeof n['maximum'] === 'number' ? (n['maximum'] as number) : undefined
  if (max !== undefined && v > max) v = max
  return v
}

// Does value `v` satisfy the scalar constraints on schema node `n`? Used to pick
// an enum member that also respects sibling constraints (REQ-SE09 validity).
function satisfies(n: Schema, v: unknown): boolean {
  const type = n['type']
  if (type === 'number' || type === 'integer') {
    if (typeof v !== 'number') return false
    if (typeof n['minimum'] === 'number' && v < (n['minimum'] as number)) return false
    if (typeof n['maximum'] === 'number' && v > (n['maximum'] as number)) return false
    if (type === 'integer' && !Number.isInteger(v)) return false
  }
  if (type === 'string') {
    if (typeof v !== 'string') return false
    if (typeof n['minLength'] === 'number' && v.length < (n['minLength'] as number)) return false
    if (typeof n['maxLength'] === 'number' && v.length > (n['maxLength'] as number)) return false
    if (typeof n['pattern'] === 'string') {
      try {
        if (!new RegExp(n['pattern'] as string).test(v)) return false
      } catch {
        /* invalid pattern -> ignore */
      }
    }
  }
  return true
}

function sampleNode(node: unknown): unknown {
  const n = isObj(node) ? node : {}
  if (n['default'] !== undefined) return n['default']
  const type = n['type']
  if (type === 'object') {
    const props = isObj(n['properties']) ? (n['properties'] as Schema) : {}
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(props)) out[k] = sampleNode(props[k])
    // required keys with no property schema still need to be PRESENT (REQ-SE09).
    for (const rk of Array.isArray(n['required']) ? (n['required'] as string[]) : []) {
      if (!(rk in out)) out[rk] = null
    }
    return out
  }
  const ex = exampleOf(n)
  if (ex !== undefined) return ex
  if (Array.isArray(n['enum']) && n['enum'].length > 0) {
    // choose the first enum member that also satisfies sibling constraints.
    const chosen = (n['enum'] as unknown[]).find((v) => satisfies(n, v))
    return chosen !== undefined ? chosen : n['enum'][0]
  }
  switch (type) {
    case 'string':
      return stringPlaceholder(n)
    case 'boolean':
      return false
    case 'array': {
      const min = typeof n['minItems'] === 'number' ? (n['minItems'] as number) : 0
      if (min <= 0) return []
      const item = sampleNode(isObj(n['items']) ? n['items'] : {})
      return Array.from({ length: min }, () => item)
    }
    case 'number':
    case 'integer':
      return numberPlaceholder(n)
    default:
      return null
  }
}

export function sampleFromSchema(schema: unknown): unknown {
  return sampleNode(schema)
}
