// spec:file-io — pure text<->value conversion & file classification.
import type { FileKind, JsonParseResult } from './types'

export function parseJsonFile(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `invalid JSON: ${message}` }
  }
}

export function serializeConfig(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

const hasSchemaShape = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  return '$schema' in obj || 'properties' in obj
}

export function classifyFile(name: string, value: unknown): FileKind {
  const lower = name.toLowerCase()
  if (lower.endsWith('.schema.json') || hasSchemaShape(value)) return 'schema'
  // REQ-F06: config is detected only for the exact name `config.json`.
  if (lower === 'config.json' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return 'config'
  }
  return 'unknown'
}
