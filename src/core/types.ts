// design:schema-model — normalized, UI-neutral field model.

export type FieldPath = string[]

type FieldBase = {
  path: FieldPath
  label: string
  description?: string
  required: boolean
}

export type StringField = FieldBase & {
  kind: 'string'
  default?: string
  example?: string
  enum?: string[]
  minLength?: number
  maxLength?: number
  pattern?: string
}

export type NumberField = FieldBase & {
  kind: 'number'
  integer: boolean
  default?: number
  example?: number
  enum?: number[]
  minimum?: number
  maximum?: number
}

export type BooleanField = FieldBase & {
  kind: 'boolean'
  default?: boolean
  example?: boolean
}

export type ObjectField = FieldBase & {
  kind: 'object'
  children: FieldNode[]
}

export type ArrayField = FieldBase & {
  kind: 'array'
  item: FieldNode
}

// Read-only placeholder for a child schema jigtor V1 cannot render (REQ-P10):
// $ref, unsupported/missing type, etc. Keeps the path so validation errors on
// this field still have a render target; `reason` explains why it is not editable.
export type UnknownField = FieldBase & {
  kind: 'unknown'
  reason: string
}

export type FieldNode =
  | StringField
  | NumberField
  | BooleanField
  | ObjectField
  | ArrayField
  | UnknownField

export type ParseResult =
  | { ok: true; root: FieldNode }
  | { ok: false; error: string }

export type FieldError = { path: FieldPath; message: string }
export type ValidationResult = { valid: boolean; errors: FieldError[] }

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export type FileKind = 'schema' | 'config' | 'unknown'
