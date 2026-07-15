// Array-aware immutable JSON edit primitives for the Tree ("real edit") mode:
// a schema-independent, Firestore-style editor that mutates the config value
// directly. Unlike the schema-form's object-only setAt, these preserve arrays
// and support numeric indices, key rename, insert, delete, reorder, and retype.

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
export type JsonPath = Array<string | number>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function valueType(v: unknown): JsonType {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  return 'string'
}

export function defaultForType(t: JsonType): unknown {
  switch (t) {
    case 'string':
      return ''
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array':
      return []
    case 'object':
      return {}
  }
}

// Retype a value while preserving what carries over (text of a number, etc.).
export function coerceType(v: unknown, t: JsonType): unknown {
  switch (t) {
    case 'string':
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    case 'number': {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return Boolean(v)
    case 'null':
      return null
    case 'array':
      return Array.isArray(v) ? v : []
    case 'object':
      return isPlainObject(v) ? v : {}
  }
}

export function jsonGet(root: unknown, path: JsonPath): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (Array.isArray(cur)) cur = cur[Number(key)]
    else if (isPlainObject(cur)) cur = cur[String(key)]
    else return undefined
  }
  return cur
}

export function jsonSet(root: unknown, path: JsonPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const arr = root.slice()
    const idx = Number(head)
    arr[idx] = jsonSet(arr[idx], rest, value)
    return arr
  }
  const obj = isPlainObject(root) ? { ...root } : {}
  const key = String(head)
  obj[key] = jsonSet(obj[key], rest, value)
  return obj
}

export function jsonDelete(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return root
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const idx = Number(head)
    if (rest.length === 0) return root.filter((_, i) => i !== idx)
    const arr = root.slice()
    arr[idx] = jsonDelete(arr[idx], rest)
    return arr
  }
  if (!isPlainObject(root)) return root
  const key = String(head)
  if (!(key in root)) return root
  if (rest.length === 0) {
    const { [key]: _drop, ...keep } = root
    return keep
  }
  return { ...root, [key]: jsonDelete(root[key], rest) }
}

// Rename an object key in place, preserving property order. No-op if the target
// container is not an object, the key is missing, or newKey already exists.
export function jsonRenameKey(
  root: unknown,
  objectPath: JsonPath,
  oldKey: string,
  newKey: string,
): unknown {
  if (oldKey === newKey) return root
  const container = jsonGet(root, objectPath)
  if (!isPlainObject(container) || !(oldKey in container) || newKey in container) return root
  const rebuilt: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(container)) rebuilt[k === oldKey ? newKey : k] = v
  return jsonSet(root, objectPath, rebuilt)
}

// Add a child: append to an array (key ignored) or add a new object key (no-op
// if the key already exists). No-op if the container is a leaf.
export function jsonInsert(
  root: unknown,
  containerPath: JsonPath,
  key: string,
  value: unknown,
): unknown {
  const container = jsonGet(root, containerPath)
  if (Array.isArray(container)) return jsonSet(root, [...containerPath, container.length], value)
  if (isPlainObject(container)) {
    if (key in container) return root
    return jsonSet(root, [...containerPath, key], value)
  }
  return root
}

export function jsonMoveItem(
  root: unknown,
  arrayPath: JsonPath,
  index: number,
  delta: number,
): unknown {
  const arr = jsonGet(root, arrayPath)
  if (!Array.isArray(arr)) return root
  const target = index + delta
  if (target < 0 || target >= arr.length) return root
  const next = arr.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return jsonSet(root, arrayPath, next)
}
