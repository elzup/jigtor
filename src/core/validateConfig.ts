// spec:validator — ajv validation with field-path-keyed errors.
import Ajv from 'ajv'
import type { ErrorObject } from 'ajv'
import type { FieldError, FieldPath, ValidationResult } from './types'

// V1 does not support $ref. An unresolvable $ref makes ajv.compile throw, which
// would fail the entire config closed (REQ-V06). Strip reference keywords so ajv
// compiles the supported subset; a $ref-only subschema becomes {} (accept-any).
//
// This must be position-aware: `$ref` is only a keyword when it is a key of a
// *schema* object. A config property literally named "$ref" lives as a KEY under
// `properties`/`patternProperties`/`$defs`/... and MUST be preserved, otherwise
// its constraints vanish and an invalid config is falsely reported valid
// (R2 FIND-R2-001). Data-bearing keywords (enum/const/default/examples) are left
// untouched so a `$ref` appearing inside sample data is never stripped either.
const REF_KEYWORDS = new Set(['$ref', '$recursiveRef', '$dynamicRef'])
// keyword -> { [propertyName]: subschema (or, for `dependencies`, subschema|string[]) }
// Includes draft-07 `dependencies` (the meta-schema ajv 8 defaults to) AND the
// 2019+ `dependentSchemas`; a $ref nested in either must be stripped or ajv
// throws and the whole config fails closed (R3 FIND-R3-001). stripRefs on an
// array value (property-dependency form) passes it through unchanged.
const SUBSCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
  'dependencies',
  'dependentSchemas',
])
// keyword -> subschema (or, for `items`, a subschema or array of subschemas)
const SUBSCHEMA_KEYWORDS = new Set([
  'items',
  'additionalProperties',
  'additionalItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
])
// keyword -> array of subschemas
const SUBSCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Walk `node` treating it as a JSON Schema, stripping $ref keywords only at
// schema positions and recursing only through schema-bearing keywords.
function stripRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRefs)
  if (!isObj(node)) return node
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(node)) {
    if (REF_KEYWORDS.has(key)) continue
    if (SUBSCHEMA_MAP_KEYWORDS.has(key) && isObj(val)) {
      const map: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(val)) map[name] = stripRefs(sub)
      out[key] = map
    } else if (SUBSCHEMA_KEYWORDS.has(key)) {
      out[key] = stripRefs(val) // handles both single-schema and tuple `items`
    } else if (SUBSCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(val)) {
      out[key] = val.map(stripRefs)
    } else {
      out[key] = val // data-bearing keyword — leave verbatim, do not recurse
    }
  }
  return out
}

// instancePath ("/a/b/0") -> ['a','b','0']. Handles JSON Pointer escapes.
function pointerToPath(pointer: string): FieldPath {
  if (pointer === '') return []
  return pointer
    .split('/')
    .slice(1)
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function toFieldError(err: ErrorObject): FieldError {
  const path = pointerToPath(err.instancePath)
  // REQ-V04: point missing-required errors at the missing key itself.
  if (err.keyword === 'required') {
    const missing = (err.params as { missingProperty?: string }).missingProperty
    if (missing) return { path: [...path, missing], message: `missing required property "${missing}"` }
  }
  return { path, message: err.message ?? 'invalid value' }
}

// Compiling a schema (and constructing Ajv) is expensive relative to running a
// validator. The UI re-validates on every keystroke while the schema stays a
// stable object reference (only the config changes), so cache the compiled
// validator — or the compile error — keyed by schema identity. A WeakMap keeps
// this leak-free: entries drop when the schema object is replaced (new file).
type Compiled =
  | { ok: true; validate: (config: unknown) => boolean; errorsOf: () => ErrorObject[] }
  | { ok: false; message: string }

const compileCache = new WeakMap<object, Compiled>()

function compileFor(schema: unknown): Compiled {
  if (typeof schema === 'object' && schema !== null) {
    const cached = compileCache.get(schema)
    if (cached) return cached
  }
  let result: Compiled
  try {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(stripRefs(schema) as object)
    result = { ok: true, validate: (c) => validate(c), errorsOf: () => validate.errors ?? [] }
  } catch (e) {
    result = { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  if (typeof schema === 'object' && schema !== null) compileCache.set(schema, result)
  return result
}

export function validateConfig(schema: unknown, config: unknown): ValidationResult {
  const compiled = compileFor(schema)
  // REQ-V05 / REQ-V06: a schema that cannot compile never throws; it surfaces a
  // single root-level error instead.
  if (!compiled.ok) {
    return { valid: false, errors: [{ path: [], message: `schema error: ${compiled.message}` }] }
  }
  const valid = compiled.validate(config)
  if (valid) return { valid: true, errors: [] }
  return { valid: false, errors: compiled.errorsOf().map(toFieldError) }
}
