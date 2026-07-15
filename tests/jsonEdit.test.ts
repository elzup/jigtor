import { describe, it, expect } from 'vitest'
import {
  valueType,
  defaultForType,
  coerceType,
  jsonGet,
  jsonSet,
  jsonDelete,
  jsonRenameKey,
  jsonInsert,
  jsonMoveItem,
} from '../src/core/jsonEdit'

describe('valueType', () => {
  it('classifies each JSON kind', () => {
    expect(valueType(null)).toBe('null')
    expect(valueType([1])).toBe('array')
    expect(valueType({})).toBe('object')
    expect(valueType(3)).toBe('number')
    expect(valueType(true)).toBe('boolean')
    expect(valueType('x')).toBe('string')
  })
})

describe('defaultForType / coerceType', () => {
  it('produces sensible defaults', () => {
    expect(defaultForType('string')).toBe('')
    expect(defaultForType('number')).toBe(0)
    expect(defaultForType('array')).toEqual([])
    expect(defaultForType('object')).toEqual({})
  })
  it('coerces while preserving what carries over', () => {
    expect(coerceType('42', 'number')).toBe(42)
    expect(coerceType('x', 'number')).toBe(0)
    expect(coerceType(5, 'string')).toBe('5')
    expect(coerceType(0, 'boolean')).toBe(false)
    expect(coerceType({ a: 1 }, 'object')).toEqual({ a: 1 })
    expect(coerceType('keep-me', 'null')).toBe(null)
  })
})

describe('jsonSet / jsonGet (array-aware, immutable)', () => {
  it('sets into nested objects and arrays without mutating', () => {
    const root = { a: { list: [1, 2, 3] } }
    const next = jsonSet(root, ['a', 'list', 1], 99)
    expect(jsonGet(next, ['a', 'list', 1])).toBe(99)
    expect(root.a.list[1]).toBe(2) // original untouched
    expect(Array.isArray(jsonGet(next, ['a', 'list']))).toBe(true) // stays an array
  })
})

describe('jsonDelete', () => {
  it('removes an object key', () => {
    expect(jsonDelete({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
  })
  it('splices an array element (no holes)', () => {
    expect(jsonDelete({ xs: [10, 20, 30] }, ['xs', 1])).toEqual({ xs: [10, 30] })
  })
})

describe('jsonRenameKey', () => {
  it('renames preserving order', () => {
    expect(jsonRenameKey({ a: 1, b: 2, c: 3 }, [], 'b', 'z')).toEqual({ a: 1, z: 2, c: 3 })
  })
  it('is a no-op when the new key already exists', () => {
    const root = { a: 1, b: 2 }
    expect(jsonRenameKey(root, [], 'a', 'b')).toBe(root)
  })
})

describe('jsonInsert', () => {
  it('appends to an array', () => {
    expect(jsonInsert({ xs: [1] }, ['xs'], '', 2)).toEqual({ xs: [1, 2] })
  })
  it('adds a new object key but not a duplicate', () => {
    expect(jsonInsert({ a: 1 }, [], 'b', 2)).toEqual({ a: 1, b: 2 })
    const root = { a: 1 }
    expect(jsonInsert(root, [], 'a', 9)).toBe(root)
  })
})

describe('jsonMoveItem', () => {
  it('reorders within bounds and no-ops outside', () => {
    expect(jsonMoveItem({ xs: [1, 2, 3] }, ['xs'], 0, 1)).toEqual({ xs: [2, 1, 3] })
    const root = { xs: [1, 2, 3] }
    expect(jsonMoveItem(root, ['xs'], 0, -1)).toBe(root)
  })
})
