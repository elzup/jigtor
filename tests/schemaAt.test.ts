import { describe, it, expect } from 'vitest'
import { resolveSchemaAt } from '../src/core/schemaAt'

const schema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['idle', 'active', 'sleep'] },
    max: { type: 'integer', minimum: 0, maximum: 100 },
    telemetry: {
      type: 'object',
      properties: { intervalSec: { type: 'number', minimum: 0.5 } },
    },
    tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
  },
}

describe('resolveSchemaAt', () => {
  it('resolves a top-level property', () => {
    expect(resolveSchemaAt(schema, ['mode'])).toMatchObject({ enum: ['idle', 'active', 'sleep'] })
  })

  it('resolves a nested object property', () => {
    expect(resolveSchemaAt(schema, ['telemetry', 'intervalSec'])).toMatchObject({ minimum: 0.5 })
  })

  it('resolves an array element via items', () => {
    expect(resolveSchemaAt(schema, ['tags', 0])).toMatchObject({ enum: ['a', 'b'] })
  })

  it('returns null for an unknown key', () => {
    expect(resolveSchemaAt(schema, ['nope'])).toBeNull()
  })

  it('returns null when descending past a leaf', () => {
    expect(resolveSchemaAt(schema, ['mode', 'x'])).toBeNull()
  })

  it('returns null for a null schema', () => {
    expect(resolveSchemaAt(null, ['mode'])).toBeNull()
  })
})
