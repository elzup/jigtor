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

export type ProjectReconnectResult =
  | {
      ok: true
      config: unknown
      schema: unknown | null
      schemaBaseline: unknown | null
      baseline: unknown
    }
  | { ok: false; error: string }

// Reconnecting a restored/imported session must not replace the in-memory
// edits. The selected file only establishes the on-disk review baseline;
// writing remains a separate, explicit action.
export function prepareProjectReconnect(
  currentConfig: unknown,
  currentSchema: unknown | null,
  targetText: string,
  projectSchema: unknown | null,
): ProjectReconnectResult {
  const parsed = parseJsonFile(targetText)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    config: currentConfig,
    schema: currentSchema ?? projectSchema,
    schemaBaseline: projectSchema,
    baseline: parsed.value,
  }
}

export type SaveTargetMode = 'direct' | 'reconnect-required' | 'download'

export function resolveSaveTargetMode(
  hasConnectedFile: boolean,
  canReconnect: boolean,
  hasConfirmedDownload: boolean,
): SaveTargetMode {
  if (hasConnectedFile) return 'direct'
  if (canReconnect && !hasConfirmedDownload) return 'reconnect-required'
  return 'download'
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
